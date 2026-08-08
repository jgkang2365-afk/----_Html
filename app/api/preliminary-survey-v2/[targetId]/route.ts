import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { workingDayDistance } from "@/lib/preliminary-survey-v2/calendar";

export async function PATCH(request: NextRequest, { params }: { params: { targetId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.role !== "관리자") return NextResponse.json({ error: "관리자만 수동 수정할 수 있습니다." }, { status: 403 });
  try {
    const targetId = Number(params.targetId);
    const body = await request.json();
    const participantIds = [...new Set((body.participantUserIds ?? []).map(Number).filter(Number.isFinite))];
    const supabase = await createClient();
    const { data: target, error: targetError } = await supabase.from("measurement_target_business").select(
      "id, measurement_date, measurer_id, preliminary_survey_rule_type",
    ).eq("id", targetId).single();
    if (targetError || !target) throw new Error("TARGET_NOT_FOUND");
    const distance = workingDayDistance(body.recommendedDate, target.measurement_date);
    if (distance === null || distance < 3) {
      return NextResponse.json({ error: "예비조사일은 측정일보다 최소 3 워킹데이 이전이어야 합니다." }, { status: 400 });
    }
    if (!participantIds.includes(Number(target.measurer_id))) {
      return NextResponse.json({ error: "보고서 담당자는 예비조사자에 반드시 포함되어야 합니다." }, { status: 400 });
    }
    const { data: users, error: userError } = await supabase.from("users").select(
      "id, name, is_preliminary_survey_experienced",
    ).in("id", participantIds);
    if (userError || (users ?? []).length !== participantIds.length) throw new Error("PARTICIPANT_NOT_FOUND");
    const responsible = users!.find((user: any) => Number(user.id) === Number(target.measurer_id));
    const reviewer = users!.find((user: any) => Number(user.id) !== Number(target.measurer_id) && user.is_preliminary_survey_experienced);
    if (!responsible?.is_preliminary_survey_experienced && !reviewer) {
      return NextResponse.json({ error: "비경력 보고서 담당자에게는 경력자 1명이 필요합니다." }, { status: 400 });
    }
    const ordered = [responsible, ...(reviewer ? [reviewer] : [])];
    const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan", {
      p_target_id: targetId,
      p_recommended_date: body.recommendedDate,
      p_responsible_user_id: Number(target.measurer_id),
      p_experienced_reviewer_id: reviewer?.id ?? null,
      p_participant_user_ids: ordered.map((user: any) => user.id),
      p_participant_names: ordered.map((user: any) => user.name),
      p_status: "recommended",
      p_plan_origin: "manual",
      p_source_measurement_date: target.measurement_date,
      p_source_responsible_user_id: Number(target.measurer_id),
      p_source_rule_type: target.preliminary_survey_rule_type === "existing" ? "existing" : "new",
      p_recommendation_reason: { reason: "관리자 수동 수정" },
      p_route_evidence: {},
      p_warnings: [],
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, plan: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MANUAL_UPDATE_FAILED" }, { status: 500 });
  }
}
