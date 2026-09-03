import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getSurveyEvent } from "@/lib/google/calendar";
import { syncBusinessToCalendar } from "@/lib/google/sync-service";
import {
  buildExpectedCalendarDays,
  summarizeCalendarResyncActions,
  validateCalendarProjection,
  type CalendarSurveyProjection,
} from "@/lib/google/calendar-resync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_PERIODS = new Set([
  "상반기",
  "상반기(수시)",
  "하반기",
  "하반기(수시)",
]);

const surveyProjectionSelect =
  "id, measurement_date, report_writer, actual_measurer, google_event_id";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "관리자") {
    return NextResponse.json(
      { success: false, error: "관리자만 캘린더 재동기화를 실행할 수 있습니다." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const code = String(body?.code || "").trim().toUpperCase();
    const year = Number(body?.year);
    const period = String(body?.period || "").trim();

    if (!code || !Number.isInteger(year) || year < 2024 || year > 2035 || !ALLOWED_PERIODS.has(period)) {
      return NextResponse.json(
        { success: false, error: "사업장 코드, 측정년도, 측정주기를 확인해 주세요." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: target, error: targetError } = await supabase
      .from("measurement_target_business")
      .select("id, code, year, period, business_name, is_registered, measurement_date, measurement_end_date, measurer_id, collaborators, daily_staff")
      .eq("code", code)
      .eq("year", year)
      .eq("period", period)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!target) {
      return NextResponse.json(
        { success: false, error: "해당 측정대상사업장을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (target.is_registered !== "실시" && target.is_registered !== "확정") {
      return NextResponse.json(
        { success: false, error: "실시 상태의 측정대상사업장만 캘린더 재동기화할 수 있습니다." },
        { status: 409 },
      );
    }

    const rawDays = Array.isArray(target.daily_staff) && target.daily_staff.length > 0
      ? target.daily_staff
      : [{
          date: target.measurement_date,
          measurer_id: target.measurer_id,
          collaborators: target.collaborators,
        }];
    const reportWriterIds = Array.from(new Set(
      rawDays
        .map((day: any) => Number(day?.measurer_id))
        .filter((id: number) => Number.isInteger(id) && id > 0),
    ));

    let users: Array<{ id: number; name: string }> = [];
    if (reportWriterIds.length > 0) {
      const { data: userRows, error: userError } = await supabase
        .from("users")
        .select("id, name")
        .in("id", reportWriterIds);
      if (userError) throw userError;
      users = (userRows || []).map((user: any) => ({ id: Number(user.id), name: String(user.name) }));
    }

    const expectedDays = buildExpectedCalendarDays(target, users);
    if (expectedDays.length === 0) {
      return NextResponse.json(
        { success: false, error: "측정예정일이 없어 캘린더를 재동기화할 수 없습니다." },
        { status: 409 },
      );
    }

    const { data: surveys, error: surveyError } = await supabase
      .from("preliminary_survey")
      .select(surveyProjectionSelect)
      .eq("code", code)
      .eq("year", year)
      .eq("period", period)
      .order("measurement_date", { ascending: true });
    if (surveyError) throw surveyError;

    const before = (surveys || []) as CalendarSurveyProjection[];
    const projectionValidation = validateCalendarProjection(expectedDays, before);
    if (!projectionValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: projectionValidation.message,
          code: "CALENDAR_SOURCE_MISMATCH",
          details: projectionValidation.details,
        },
        { status: 409 },
      );
    }

    const syncResult = await syncBusinessToCalendar(supabase, code, year, period);
    if (!syncResult?.success) {
      throw new Error("캘린더 동기화 결과를 확인하지 못했습니다.");
    }

    const { data: afterRows, error: afterError } = await supabase
      .from("preliminary_survey")
      .select(surveyProjectionSelect)
      .eq("code", code)
      .eq("year", year)
      .eq("period", period)
      .order("measurement_date", { ascending: true });
    if (afterError) throw afterError;

    const after = (afterRows || []) as CalendarSurveyProjection[];
    const actions = summarizeCalendarResyncActions(before, after);

    const verifiedEvents: Array<{
      date: string;
      eventId: string;
      summary: string | null;
    }> = [];

    for (const survey of after) {
      if (!survey.measurement_date) continue;
      if (!survey.google_event_id) {
        throw new Error(`${survey.measurement_date} 캘린더 이벤트 ID가 저장되지 않았습니다.`);
      }

      const event = await getSurveyEvent(survey.google_event_id);
      if (!event || event.status === "cancelled") {
        throw new Error(`${survey.measurement_date} 캘린더 이벤트를 확인할 수 없습니다.`);
      }

      const eventDate = event.start?.date || null;
      if (eventDate !== survey.measurement_date) {
        throw new Error(
          `${survey.measurement_date} 캘린더 날짜 검증 실패: 실제 ${eventDate || "없음"}`,
        );
      }

      verifiedEvents.push({
        date: survey.measurement_date,
        eventId: survey.google_event_id,
        summary: event.summary || null,
      });
    }

    return NextResponse.json({
      success: true,
      business: {
        code,
        year,
        period,
        name: target.business_name,
      },
      actions,
      events: verifiedEvents,
      syncedEventCount: syncResult.syncedEventCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Admin Calendar Resync] 실패:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
