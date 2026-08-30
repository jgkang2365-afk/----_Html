import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { operationalMeasurementUsers } from "@/lib/business/operational-measurement-user";

export const dynamic = "force-dynamic";

/** 측정대상사업장 날짜별 참여자/보고서 담당자 원천만 고치는 관리자 repair 경로다. */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const supabase = await createClient();
    if (!await canManagePreliminarySurvey(supabase, session)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const body = await request.json();
    const targetId = Number(body.targetId);
    const measurementDate = String(body.measurementDate ?? "").trim();
    const participantUserIds = Array.isArray(body.participantUserIds) ? [...new Set(body.participantUserIds.map(Number))] : [];
    const reportWriterUserId = body.reportWriterUserId == null ? null : Number(body.reportWriterUserId);
    const reason = String(body.reason ?? "").trim();
    if (!Number.isInteger(targetId) || !/^\d{4}-\d{2}-\d{2}$/.test(measurementDate) || !reason ||
        participantUserIds.some((id) => !Number.isInteger(id) || id <= 0) ||
        (reportWriterUserId != null && (!Number.isInteger(reportWriterUserId) || reportWriterUserId <= 0))) {
      return NextResponse.json({ error: "INVALID_MEASUREMENT_SOURCE_REPAIR" }, { status: 400 });
    }
    const userIds = [...new Set([...participantUserIds, ...(reportWriterUserId == null ? [] : [reportWriterUserId])])];
    const [{ data: target, error: targetError }, { data: users, error: userError }] = await Promise.all([
      supabase.from("measurement_target_business").select("measurement_date, daily_staff, collaborators, measurer_id").eq("id", targetId).maybeSingle(),
      userIds.length ? supabase.from("users").select("id, name, job, is_active").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (targetError || !target) return NextResponse.json({ error: "TARGET_NOT_FOUND" }, { status: 404 });
    if (userError) throw userError;
    const usersById = new Map(operationalMeasurementUsers(users).map((user: any) => [Number(user.id), String(user.name)]));
    if (!userIds.every((id) => usersById.has(id))) return NextResponse.json({ error: "INELIGIBLE_OPERATIONAL_USER" }, { status: 400 });
    const participantNames = participantUserIds.map((id) => usersById.get(id)!);
    const { error } = await supabase.rpc("repair_preliminary_survey_measurement_source", {
      p_target_id: targetId,
      p_expected_measurement_date: target.measurement_date,
      p_expected_daily_staff: target.daily_staff ?? null,
      p_expected_collaborators: target.collaborators ?? null,
      p_expected_measurer_id: target.measurer_id ?? null,
      p_measurement_date: measurementDate,
      p_participant_names: participantNames,
      p_report_writer_user_id: reportWriterUserId,
      p_reason: reason,
      p_changed_by_user_id: session.userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ success: true, repairedFields: ["measurement_participants", ...(reportWriterUserId == null ? [] : ["report_writer"])] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MEASUREMENT_SOURCE_REPAIR_FAILED" }, { status: 500 });
  }
}
