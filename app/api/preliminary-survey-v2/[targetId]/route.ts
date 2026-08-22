import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { validateManualPlanHardRules } from "@/lib/preliminary-survey-v2/manual-validation";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import { loadV2ManualContext } from "@/lib/preliminary-survey-v2/service";
import { surveyMethodForKind, type SurveyUser } from "@/lib/preliminary-survey-v2/types";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";

export async function PATCH(request: NextRequest, { params }: { params: { targetId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const targetId = Number(params.targetId);
    const body = await request.json();
    const participantIds = [...new Set((body.participantUserIds ?? []).map(Number).filter(Number.isFinite))];
    const supabase = await createClient();
    if (!await canManagePreliminarySurvey(supabase, session)) {
      return NextResponse.json({ error: "예비조사 담당자 또는 관리자만 수동 수정할 수 있습니다." }, { status: 403 });
    }
    const { target, users, assignments } = await loadV2ManualContext(supabase, targetId, body.recommendedDate);
    const participants = participantIds.map((id) => users.find((user) => user.id === id))
      .filter((user): user is SurveyUser => Boolean(user));
    if (participants.length !== participantIds.length) throw new Error("PARTICIPANT_NOT_FOUND");
    // 경력+비경력 조합에서는 비경력자가 페이퍼 작성자, 경력자 단독이면 경력자가 작성한다.
    // 측정자/보고서 담당자/link_measurer_id에서는 예비조사 책임자를 추론하지 않는다.
    const responsible = participants.find((user) => !user.experienced) ?? participants[0];
    if (!responsible) throw new Error("NO_SURVEYOR");
    const validationTarget = { ...target, responsible };
    const validation = await validateManualPlanHardRules({
      target: validationTarget, recommendedDate: body.recommendedDate, participants,
      existingAssignments: assignments, routes: createRouteMetrics(),
    });
    if (!validation.valid) return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });

    // 경력자 2명 이상 조합은 사용자 확인 전에는 저장하지 않는다.
    // 1차 요청(confirm 미포함)에서는 계획을 저장하지 않고 확인 요청만 반환한다.
    const confirmed = body.confirm === true;
    if (validation.requiresUserConfirmation && !confirmed) {
      return NextResponse.json({
        success: false,
        requiresUserConfirmation: true,
        message: "경력자 2명이 예비조사자로 지정되었습니다. 이 조합으로 확정하시겠습니까?",
        recommendedDate: body.recommendedDate,
        participantUserIds: participantIds,
        participantNames: participants.map((user) => user.name),
      });
    }
    const ordered = [...participants].sort((left, right) =>
      Number(right.id === responsible.id) - Number(left.id === responsible.id) || left.id - right.id,
    );
    const surveyMethod = body.surveyMethod === "field" || body.surveyMethod === "phone"
      ? body.surveyMethod
      : surveyMethodForKind(target.kind);
    const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan", {
      p_target_id: targetId,
      p_recommended_date: body.recommendedDate,
      p_responsible_user_id: responsible.id,
      p_experienced_reviewer_id: validation.experiencedReviewer?.id ?? null,
      p_participant_user_ids: ordered.map((user) => user.id),
      p_participant_names: ordered.map((user) => user.name),
      p_status: "recommended",
      p_plan_origin: "manual",
      p_source_measurement_date: target.measurementDate,
      p_source_responsible_user_id: target.sourceMeasurerId,
      p_source_rule_type: target.kind,
      p_survey_method: surveyMethod,
      p_recommendation_reason: {
        reason: "관리자 수동 수정", classificationSource: target.classificationSource, surveyMethod,
      },
      p_route_evidence: { sameDayRoutes: validation.routeEvidence },
      p_warnings: [],
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      success: true,
      plan: Array.isArray(data) ? data[0] : data,
      requiresUserConfirmation: validation.requiresUserConfirmation,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MANUAL_UPDATE_FAILED" }, { status: 500 });
  }
}
