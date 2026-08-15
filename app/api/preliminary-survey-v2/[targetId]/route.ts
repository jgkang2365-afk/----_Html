import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { validateManualPlanHardRules } from "@/lib/preliminary-survey-v2/manual-validation";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import { loadV2ManualContext } from "@/lib/preliminary-survey-v2/service";
import { surveyMethodForKind, type SurveyUser } from "@/lib/preliminary-survey-v2/types";

export async function PATCH(request: NextRequest, { params }: { params: { targetId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (session.role !== "관리자") return NextResponse.json({ error: "관리자만 수동 수정할 수 있습니다." }, { status: 403 });
  try {
    const targetId = Number(params.targetId);
    const body = await request.json();
    const participantIds = [...new Set((body.participantUserIds ?? []).map(Number).filter(Number.isFinite))];
    const supabase = await createClient();
    const { target, users, assignments } = await loadV2ManualContext(supabase, targetId, body.recommendedDate);
    const participants = participantIds.map((id) => users.find((user) => user.id === id))
      .filter((user): user is SurveyUser => Boolean(user));
    if (participants.length !== participantIds.length) throw new Error("PARTICIPANT_NOT_FOUND");
    const validation = await validateManualPlanHardRules({
      target, recommendedDate: body.recommendedDate, participants,
      existingAssignments: assignments, routes: createRouteMetrics(),
    });
    if (!validation.valid) return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });
    const ordered = [...participants].sort((left, right) =>
      Number(right.id === target.responsible.id) - Number(left.id === target.responsible.id) || left.id - right.id,
    );
    const surveyMethod = body.surveyMethod === "field" || body.surveyMethod === "phone"
      ? body.surveyMethod
      : surveyMethodForKind(target.kind);
    const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan", {
      p_target_id: targetId,
      p_recommended_date: body.recommendedDate,
      p_responsible_user_id: target.responsible.id,
      p_experienced_reviewer_id: validation.experiencedReviewer?.id ?? null,
      p_participant_user_ids: ordered.map((user) => user.id),
      p_participant_names: ordered.map((user) => user.name),
      p_status: "recommended",
      p_plan_origin: "manual",
      p_source_measurement_date: target.measurementDate,
      p_source_responsible_user_id: target.responsible.id,
      p_source_rule_type: target.kind,
      p_survey_method: surveyMethod,
      p_recommendation_reason: {
        reason: "관리자 수동 수정", classificationSource: target.classificationSource, surveyMethod,
      },
      p_route_evidence: { sameDayRoutes: validation.routeEvidence },
      p_warnings: [],
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, plan: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MANUAL_UPDATE_FAILED" }, { status: 500 });
  }
}
