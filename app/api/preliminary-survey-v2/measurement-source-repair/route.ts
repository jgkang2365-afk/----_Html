import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { operationalMeasurementUsers } from "@/lib/business/operational-measurement-user";
import { measurementStaffForDate } from "@/lib/preliminary-survey-v2/measurement-staff";

export const dynamic = "force-dynamic";

async function requireRepairAccess() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const supabase = await createClient();
  if (!await canManagePreliminarySurvey(supabase, session)) {
    return { response: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { session, supabase };
}

/** 현재 원천 스냅샷을 읽어 관리자 UI가 선택하지 않은 역할을 보존하게 한다. */
export async function GET(request: NextRequest) {
  try {
    const access = await requireRepairAccess();
    if ("response" in access) return access.response;
    const targetId = Number(new URL(request.url).searchParams.get("targetId"));
    if (!Number.isInteger(targetId) || targetId <= 0) return NextResponse.json({ error: "INVALID_TARGET_ID" }, { status: 400 });
    const [{ data: target, error: targetError }, { data: users, error: userError }] = await Promise.all([
      access.supabase.from("measurement_target_business")
        .select("measurement_date, daily_staff, collaborators, measurer_id").eq("id", targetId).maybeSingle(),
      access.supabase.from("users").select("id, name, job, is_active").eq("job", "측정"),
    ]);
    if (targetError || !target) return NextResponse.json({ error: "TARGET_NOT_FOUND" }, { status: 404 });
    if (userError) throw userError;
    const operationalUsers = operationalMeasurementUsers(users);
    const userNameById = new Map(operationalUsers.map((user: any) => [Number(user.id), String(user.name)]));
    const userIdByName = new Map(operationalUsers.map((user: any) => [String(user.name).trim(), Number(user.id)]));
    const dates = Array.isArray(target.daily_staff)
      ? target.daily_staff.map((day: any) => String(day?.date ?? "")).filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      : [String(target.measurement_date ?? "")];
    return NextResponse.json({
      targetId,
      sources: [...new Set(dates)].sort().map((measurementDate) => {
        const staff = measurementStaffForDate({
          dailyStaff: target.daily_staff,
          measurementDate,
          collaborators: target.collaborators,
          userNameById,
        });
        return {
          measurementDate,
          participantUserIds: staff.measurementParticipants === "-" ? [] : staff.measurementParticipants.split(", ")
            .map((name) => userIdByName.get(name.trim())).filter((userId): userId is number => userId != null),
          reportWriterUserId: Array.isArray(target.daily_staff)
            ? Number(target.daily_staff.find((day: any) => String(day?.date ?? "") === measurementDate)?.measurer_id) || null
            : Number(target.measurer_id) || null,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MEASUREMENT_SOURCE_REPAIR_QUERY_FAILED" }, { status: 500 });
  }
}

/** 측정대상사업장 날짜별 참여자/보고서 담당자 원천만 고치는 관리자 repair 경로다. */
export async function POST(request: NextRequest) {
  try {
    const access = await requireRepairAccess();
    if ("response" in access) return access.response;
    const body = await request.json();
    const targetId = Number(body.targetId);
    const measurementDate = String(body.measurementDate ?? "").trim();
    const repairParticipants = body.repairParticipants === true;
    const repairReportWriter = body.repairReportWriter === true;
    const participantUserIds = repairParticipants && Array.isArray(body.participantUserIds)
      ? [...new Set(body.participantUserIds.map(Number))] : [];
    const reportWriterUserId = repairReportWriter ? (body.reportWriterUserId == null ? null : Number(body.reportWriterUserId)) : null;
    const reason = String(body.reason ?? "").trim();
    if (!Number.isInteger(targetId) || !/^\d{4}-\d{2}-\d{2}$/.test(measurementDate) || !reason || (!repairParticipants && !repairReportWriter) ||
        participantUserIds.some((id) => !Number.isInteger(id) || id <= 0) ||
        (reportWriterUserId != null && (!Number.isInteger(reportWriterUserId) || reportWriterUserId <= 0))) {
      return NextResponse.json({ error: "INVALID_MEASUREMENT_SOURCE_REPAIR" }, { status: 400 });
    }
    const userIds = [...new Set([...participantUserIds, ...(reportWriterUserId == null ? [] : [reportWriterUserId])])];
    const [{ data: target, error: targetError }, { data: users, error: userError }] = await Promise.all([
      access.supabase.from("measurement_target_business").select("measurement_date, daily_staff, collaborators, measurer_id").eq("id", targetId).maybeSingle(),
      userIds.length ? access.supabase.from("users").select("id, name, job, is_active").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (targetError || !target) return NextResponse.json({ error: "TARGET_NOT_FOUND" }, { status: 404 });
    if (userError) throw userError;
    const usersById = new Map(operationalMeasurementUsers(users).map((user: any) => [Number(user.id), String(user.name)]));
    if (!userIds.every((id) => usersById.has(id))) return NextResponse.json({ error: "INELIGIBLE_OPERATIONAL_USER" }, { status: 400 });
    const participantNames = participantUserIds.map((id) => usersById.get(id)!);
    const { error } = await access.supabase.rpc("repair_preliminary_survey_measurement_source", {
      p_target_id: targetId,
      p_expected_measurement_date: target.measurement_date,
      p_expected_daily_staff: target.daily_staff ?? null,
      p_expected_collaborators: target.collaborators ?? null,
      p_expected_measurer_id: target.measurer_id ?? null,
      p_measurement_date: measurementDate,
      p_repair_participants: repairParticipants,
      p_participant_names: participantNames,
      p_repair_report_writer: repairReportWriter,
      p_report_writer_user_id: reportWriterUserId,
      p_reason: reason,
      p_changed_by_user_id: access.session.userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({
      success: true,
      repairedFields: [
        ...(repairParticipants ? ["measurement_participants"] : []),
        ...(repairReportWriter ? ["report_writer"] : []),
      ],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MEASUREMENT_SOURCE_REPAIR_FAILED" }, { status: 500 });
  }
}
