import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { recommendationDatesForBusinessType } from "@/lib/preliminary-survey-v2/calendar";
import { buildScheduleBlockKeys } from "@/lib/preliminary-survey-v2/availability";
import { validateManualPlanHardRules } from "@/lib/preliminary-survey-v2/manual-validation";
import { loadActualMeasurementBlockedKeys } from "@/lib/preliminary-survey-v2/measurement-conflicts";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import { loadV2ManualContext } from "@/lib/preliminary-survey-v2/service";
import type { SurveyUser } from "@/lib/preliminary-survey-v2/types";
import {
  checkPreliminarySurveyDatePolicy,
  checkPreliminarySurveyMethodPolicy,
  preliminarySurveyDatePolicyMessage,
  preliminarySurveyMethodPolicyMessage,
} from "@/lib/preliminary-survey-v2/policy-compliance";

export const dynamic = "force-dynamic";

function targetIdFrom(value: unknown) {
  const targetId = Number(value);
  return Number.isInteger(targetId) && targetId > 0 ? targetId : null;
}

async function guard() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const supabase = await createClient();
  if (!await canManagePreliminarySurvey(supabase, session)) {
    return { response: NextResponse.json({ error: "예비조사 담당자 또는 관리자만 찐확정 repair를 수행할 수 있습니다." }, { status: 403 }) };
  }
  return { session, supabase };
}

async function loadRepairContext(supabase: any, targetId: number) {
  const { data: target, error: targetError } = await supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, measurement_date, business_type",
  ).eq("id", targetId).maybeSingle();
  if (targetError || !target) throw new Error("TARGET_NOT_FOUND");
  const [{ data: plan, error: planError }, { data: journals, error: journalError }] = await Promise.all([
    supabase.from("preliminary_survey_v2_plans").select(
      "id, recommended_date, participant_user_ids, responsible_user_id, survey_method",
    ).eq("measurement_target_business_id", targetId).maybeSingle(),
    supabase.from("measurement_journal").select("id, measurement_period").eq("code", target.code)
      .eq("measurement_year", target.year),
  ]);
  if (planError || journalError) throw planError || journalError;
  const normalizedPeriod = String(target.period ?? "").trim().replace("(수시)", "");
  if (!(journals ?? []).some((journal: any) => String(journal.measurement_period ?? "").trim().replace("(수시)", "") === normalizedPeriod)) {
    throw new Error("TRUE_CONFIRMED_REQUIRED");
  }
  const datePolicy = checkPreliminarySurveyDatePolicy({
    measurementDate: target.measurement_date,
    preliminaryDate: plan?.recommended_date,
    businessType: target.business_type,
  });
  const methodPolicyIssue = plan ? checkPreliminarySurveyMethodPolicy({
    businessType: target.business_type,
    surveyMethod: plan.survey_method,
  }) : null;
  if (datePolicy.compliant && !methodPolicyIssue) throw new Error("POLICY_REPAIR_NOT_REQUIRED");
  if (!target.business_type || !target.measurement_date) throw new Error("POLICY_DATE_REPAIR_SOURCE_INCOMPLETE");
  return {
    target,
    plan,
    datePolicy,
    methodPolicyIssue,
    candidateDates: recommendationDatesForBusinessType(target.measurement_date, target.business_type).map((item) => item.date),
  };
}

/**
 * 날짜 후보만 맞는 찐확정 repair는 허용하지 않는다. 현재 원천의 기존 예비조사자·방식으로
 * manual 저장과 같은 hard rule(불가 일정, 실제 측정 충돌, 용량, 방문 동선)을 통과해야 한다.
 */
async function validatePolicyRepairHardRules(supabase: any, targetId: number, plan: any, recommendedDate: string, surveyMethod = plan.survey_method) {
  const context = await loadV2ManualContext(supabase, targetId, recommendedDate);
  const participantIds = [...new Set(
    Array.isArray(plan.participant_user_ids)
      ? plan.participant_user_ids.map(Number).filter((userId: number) => Number.isInteger(userId))
      : [],
  )] as number[];
  const participants = participantIds.map((id) => context.users.find((user) => user.id === id))
    .filter((user): user is SurveyUser => Boolean(user));
  const responsible = context.users.find((user) => user.id === Number(plan.responsible_user_id));
  if (!responsible || participants.length !== participantIds.length || !participants.some((user) => user.id === responsible.id)) {
    throw new Error("POLICY_DATE_REPAIR_MANUAL_REVIEW:PLAN_PARTICIPANT_CONTEXT_INVALID");
  }
  const [{ data: scheduleBlocks, error: scheduleBlockError }, measurementBlockedKeys] = await Promise.all([
    supabase.from("user_schedule_blocks").select("user_id, start_date, end_date")
      .lte("start_date", recommendedDate).gte("end_date", recommendedDate),
    loadActualMeasurementBlockedKeys(supabase, [recommendedDate], context.users),
  ]);
  if (scheduleBlockError) throw new Error(`POLICY_DATE_REPAIR_SCHEDULE_QUERY_FAILED:${scheduleBlockError.message}`);
  const scheduleBlockedKeys = buildScheduleBlockKeys(scheduleBlocks ?? []);
  const validation = await validateManualPlanHardRules({
    target: { ...context.target, responsible },
    recommendedDate,
    participants,
    surveyMethod: surveyMethod === "field" ? "field" : "phone",
    existingAssignments: context.assignments,
    routes: createRouteMetrics(),
    experiencedUsers: context.users.filter((user) => user.experienced),
    availability: {
      isBlocked: (userId, date) => scheduleBlockedKeys.has(`${userId}:${date}`) || measurementBlockedKeys.has(`${userId}:${date}`),
      isScheduleBlocked: (userId, date) => scheduleBlockedKeys.has(`${userId}:${date}`),
      isActualMeasurementBlocked: (userId, date) => measurementBlockedKeys.has(`${userId}:${date}`),
    },
  });
  if (!validation.valid) throw new Error(`POLICY_DATE_REPAIR_MANUAL_REVIEW:${validation.errors.join(" | ")}`);
}

export async function POST(request: NextRequest) {
  try {
    const access = await guard();
    if ("response" in access) return access.response;
    const body = await request.json();
    const targetId = targetIdFrom(body.targetId);
    if (!targetId) return NextResponse.json({ error: "INVALID_TARGET_ID" }, { status: 400 });
    const context = await loadRepairContext(access.supabase, targetId);
    if (body.action === "preview") {
      return NextResponse.json({
        success: true,
        targetId,
        code: context.target.code,
        businessName: context.target.business_name,
        currentRecommendedDate: context.plan?.recommended_date ?? null,
        candidateDates: context.candidateDates,
        policyIssues: context.datePolicy.issues,
        reason: preliminarySurveyDatePolicyMessage(context.datePolicy),
        methodPolicyIssue: context.methodPolicyIssue,
        methodReason: preliminarySurveyMethodPolicyMessage(context.methodPolicyIssue),
      });
    }
    if (body.action === "apply_method") {
      const reason = String(body.reason ?? "").trim();
      if (!context.plan?.id || !context.methodPolicyIssue || !reason) {
        return NextResponse.json({ error: "INVALID_POLICY_METHOD_REPAIR" }, { status: 400 });
      }
      await validatePolicyRepairHardRules(
        access.supabase, targetId, context.plan, String(context.plan.recommended_date ?? ""), "field",
      );
      const { error } = await access.supabase.rpc("repair_true_confirmed_preliminary_v2_policy_method", {
        p_target_id: targetId,
        p_expected_plan_id: context.plan.id,
        p_expected_survey_method: context.plan.survey_method,
        p_reason: reason,
        p_changed_by_user_id: access.session.userId,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 409 });
      return NextResponse.json({ success: true, repairedFields: ["survey_method"] });
    }
    const recommendedDate = String(body.recommendedDate ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (body.action !== "apply" || context.datePolicy.compliant || !context.plan?.id || !context.candidateDates.includes(recommendedDate) || !reason) {
      return NextResponse.json({ error: "INVALID_POLICY_DATE_REPAIR" }, { status: 400 });
    }
    await validatePolicyRepairHardRules(access.supabase, targetId, context.plan, recommendedDate);
    const { error } = await access.supabase.rpc("repair_true_confirmed_preliminary_v2_policy_date", {
      p_target_id: targetId,
      p_expected_plan_id: context.plan.id,
      p_expected_source_measurement_date: context.target.measurement_date,
      p_expected_recommended_date: context.plan.recommended_date,
      p_recommended_date: recommendedDate,
      p_reason: reason,
      p_changed_by_user_id: access.session.userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ success: true, repairedFields: ["recommended_date"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "POLICY_DATE_REPAIR_FAILED";
    return NextResponse.json(
      { error: message },
      { status: message === "TRUE_CONFIRMED_REQUIRED" || message.startsWith("POLICY_DATE_REPAIR_MANUAL_REVIEW:") ? 409 : 500 },
    );
  }
}
