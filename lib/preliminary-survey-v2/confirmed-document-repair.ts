import { calculateV2Recommendations, loadV2ManualContext } from "./service";
import { HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES } from "./historical-plan-recovery";
import { splitNames } from "../business/link-measurer";
import { validateManualPlanHardRules } from "./manual-validation";
import { createRouteMetrics } from "./route-metrics";
import type { SurveyUser } from "./types";

export type ConfirmedRepairClassification = "COMPLETE" | "MISSING_DOCUMENTARY_INFO" | "PROTECTED_MANUAL" | "NEEDS_MANUAL_REVIEW";

export interface ConfirmedDocumentRepairDraft {
  targetId: number;
  code: string;
  businessName: string;
  classification: ConfirmedRepairClassification;
  fillDate: boolean;
  fillSurveyors: boolean;
  recommendedDate: string | null;
  responsibleUserId: number | null;
  experiencedReviewerUserId: number | null;
  participantUserIds: number[];
  participantNames: string[];
  surveyMethod: "field" | "phone" | null;
  sourceMeasurementDate: string;
  sourceRuleType: "new" | "existing" | null;
  reason: string;
  existingPlanId: string | null;
}

export function classifyConfirmedDocumentState(plan: {
  recommended_date?: string | null;
  participant_user_ids?: unknown;
} | null, protectedSource: boolean) {
  const fillDate = !plan?.recommended_date;
  const fillSurveyors = !Array.isArray(plan?.participant_user_ids) || plan.participant_user_ids.length === 0;
  return {
    fillDate,
    fillSurveyors,
    classification: !fillDate && !fillSurveyors
      ? "COMPLETE" as const
      : protectedSource ? "PROTECTED_MANUAL" as const : "MISSING_DOCUMENTARY_INFO" as const,
  };
}

function journalKey(row: { code: unknown; year: unknown; period: unknown }) {
  return `${String(row.code)}|${Number(row.year)}|${String(row.period ?? "").trim().replace("(수시)", "")}`;
}

/** 읽기 전용 preview. 일반 추천/apply에 섞지 않는다. */
export async function buildConfirmedDocumentRepairPreview(supabase: any, targetIds: number[]) {
  if (!targetIds.length) return { drafts: [] as ConfirmedDocumentRepairDraft[], unchangedCount: 0, manualReviewCount: 0 };
  const canonicalTargetIds = [...targetIds].sort((left, right) => left - right);
  const { data: targets, error: targetError } = await supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, measurement_date",
  ).in("id", canonicalTargetIds);
  if (targetError) throw targetError;
  const ids = (targets ?? []).map((target: any) => Number(target.id));
  const codes = [...new Set((targets ?? []).map((target: any) => String(target.code)))];
  const [{ data: plans, error: planError }, { data: journals, error: journalError }, { data: legacyRows, error: legacyError }] = await Promise.all([
    supabase.from("preliminary_survey_v2_plans").select("*").in("measurement_target_business_id", ids),
    supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", codes),
    supabase.from("preliminary_survey").select("code, year, period, measurement_date, preliminary_surveyor").in("code", codes),
  ]);
  if (planError || journalError || legacyError) throw planError || journalError || legacyError;
  const planIds = (plans ?? []).map((plan: any) => String(plan.id));
  const [{ data: reconciliation, error: reconciliationError }, { data: history, error: historyError }] = await Promise.all([
    planIds.length ? supabase.from("preliminary_survey_v2_legacy_reconciliation").select("applied_plan_id").in("applied_plan_id", planIds) : Promise.resolve({ data: [], error: null }),
    planIds.length ? supabase.from("preliminary_survey_v2_history_recovery_audit").select("created_plan_id").in("created_plan_id", planIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (reconciliationError || historyError) throw reconciliationError || historyError;
  const protectedPlanIds = new Set([
    ...(reconciliation ?? []).map((row: any) => String(row.applied_plan_id)),
    ...(history ?? []).map((row: any) => String(row.created_plan_id)),
  ]);
  const confirmed = new Set((journals ?? []).map((row: any) => journalKey({
    code: row.code, year: row.measurement_year, period: row.measurement_period,
  })));
  const planByTarget = new Map((plans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
  const legacyByTargetKey = new Map((legacyRows ?? []).map((row: any) => [
    `${String(row.code)}|${Number(row.year)}|${String(row.period ?? "").trim().replace("(수시)", "")}|${String(row.measurement_date ?? "")}`,
    row,
  ]));
  const orderedTargets = [...(targets ?? [])].sort((left: any, right: any) => Number(left.id) - Number(right.id));
  const missingTargets = orderedTargets.filter((target: any) => confirmed.has(journalKey(target))).map((target: any) => {
    const plan: any = planByTarget.get(Number(target.id));
    const protectedSource = HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES.has(String(target.code)) || Boolean(plan && protectedPlanIds.has(String(plan.id)));
    const state = classifyConfirmedDocumentState(plan, protectedSource);
    return {
      target,
      plan,
      fillDate: state.fillDate,
      fillSurveyors: state.fillSurveyors,
      protected: protectedSource,
    };
  }).filter((entry: any) => entry.fillDate || entry.fillSurveyors);
  const repairableIds = missingTargets.filter((entry: any) => !entry.protected).map((entry: any) => Number(entry.target.id));
  const calculation = repairableIds.length ? await calculateV2Recommendations(supabase, { targetIds: repairableIds }) : null;
  const resultByTarget = new Map((calculation?.results ?? []).map((result) => [result.targetId, result]));
  const targetById = new Map((calculation?.targets ?? []).map((target) => [target.id, target]));
  const drafts: ConfirmedDocumentRepairDraft[] = await Promise.all(missingTargets.map(async (entry: any) => {
    const targetId = Number(entry.target.id);
    const result: any = resultByTarget.get(targetId);
    const calculatedTarget: any = targetById.get(targetId);
    if (entry.protected) return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "PROTECTED_MANUAL", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors,
      recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
      participantUserIds: [], participantNames: [], surveyMethod: null,
      sourceMeasurementDate: entry.target.measurement_date, sourceRuleType: null,
      reason: "역사 복원/수동 보정 보호 대상 · 원천 확인 필요", existingPlanId: entry.plan?.id ?? null,
    };
    if (!result || result.status !== "recommended" || !result.date) return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors,
      recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
      participantUserIds: [], participantNames: [], surveyMethod: null,
      sourceMeasurementDate: entry.target.measurement_date, sourceRuleType: calculatedTarget?.kind ?? null,
      reason: result?.reason ?? "정책에 맞는 누락정보 보정안을 구성할 수 없습니다.", existingPlanId: entry.plan?.id ?? null,
    };
    const repairDate = entry.fillDate ? result.date : entry.plan.recommended_date;
    const surveyMethod = entry.plan?.survey_method ?? result.surveyMethod;
    let participantUserIds = entry.fillSurveyors ? result.participants.map((user: any) => user.id) : entry.plan.participant_user_ids.map(Number);
    let participantNames = entry.fillSurveyors ? result.participants.map((user: any) => user.name) : entry.plan.participant_names.map(String);
    let responsibleUserId = entry.plan ? Number(entry.plan.responsible_user_id) : result.responsible.id;
    let experiencedReviewerUserId = entry.plan?.experienced_reviewer_id ?? result.experiencedReviewer?.id ?? null;
    const legacy: any = legacyByTargetKey.get(
      `${String(entry.target.code)}|${Number(entry.target.year)}|${String(entry.target.period ?? "").trim().replace("(수시)", "")}|${String(entry.target.measurement_date)}`,
    );
    const legacyNames = entry.fillSurveyors ? splitNames(legacy?.preliminary_surveyor) : [];
    if (entry.plan || legacyNames.length) {
      const context = await loadV2ManualContext(supabase, targetId, repairDate);
      const usersById = new Map<number, SurveyUser>(context.users.map((user: SurveyUser) => [user.id, user]));
      const usersByName = new Map<string, SurveyUser>(context.users.map((user: SurveyUser) => [user.name, user]));
      let participants: Array<SurveyUser | undefined | null> = participantUserIds.map((userId: number) => usersById.get(userId));
      if (legacyNames.length) participants = legacyNames.map((name) => usersByName.get(name));
      if (entry.plan && entry.fillSurveyors && !legacyNames.length) {
        const preservedResponsible = usersById.get(Number(entry.plan.responsible_user_id));
        const preservedReviewer = entry.plan.experienced_reviewer_id == null
          ? null : usersById.get(Number(entry.plan.experienced_reviewer_id));
        const recommendedReviewer = result.participants.find((user: any) => user.experienced && user.id !== preservedResponsible?.id);
        participants = [preservedResponsible, preservedReviewer ?? recommendedReviewer].filter(Boolean);
      }
      if (participants.some((user) => !user)) return {
        targetId, code: entry.target.code, businessName: entry.target.business_name,
        classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors,
        recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
        participantUserIds: [], participantNames: [], surveyMethod: null,
        sourceMeasurementDate: entry.target.measurement_date, sourceRuleType: calculatedTarget?.kind ?? null,
        reason: legacyNames.length ? "legacy 예비조사자 원천의 사용자 매핑을 확인해야 합니다." : "기존 예비조사자 원천의 사용자 매핑을 확인해야 합니다.",
        existingPlanId: entry.plan?.id ?? null,
      };
      const validParticipants = [...new Map<number, SurveyUser>(participants
        .filter((user): user is SurveyUser => Boolean(user))
        .map((user) => [user.id, user])).values()];
      const responsible = entry.plan ? usersById.get(Number(entry.plan.responsible_user_id)) : validParticipants[0];
      if (!responsible) throw new Error("REPAIR_RESPONSIBLE_MAPPING_FAILED");
      const { data: blocks, error: blockError } = await supabase.from("user_schedule_blocks")
        .select("user_id").in("user_id", validParticipants.map((user) => user.id))
        .lte("start_date", repairDate).gte("end_date", repairDate);
      if (blockError) throw blockError;
      const validation = await validateManualPlanHardRules({
        target: { ...context.target, responsible },
        recommendedDate: repairDate,
        participants: validParticipants,
        surveyMethod,
        existingAssignments: context.assignments,
        routes: createRouteMetrics(),
      });
      if ((blocks ?? []).length || !validation.valid) return {
        targetId, code: entry.target.code, businessName: entry.target.business_name,
        classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors,
        recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
        participantUserIds: [], participantNames: [], surveyMethod: null,
        sourceMeasurementDate: entry.target.measurement_date, sourceRuleType: calculatedTarget?.kind ?? null,
        reason: `보존할 조사자 원천이 보정 날짜의 hard rule을 충족하지 않습니다: ${validation.errors.join(" · ") || "직원 불가 일정"}`,
        existingPlanId: entry.plan?.id ?? null,
      };
      participantUserIds = validParticipants.map((user) => user.id);
      participantNames = validParticipants.map((user) => user.name);
      responsibleUserId = responsible.id;
      experiencedReviewerUserId = entry.plan?.experienced_reviewer_id ?? validation.experiencedReviewer?.id ?? null;
    }
    return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "MISSING_DOCUMENTARY_INFO", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors,
      recommendedDate: repairDate,
      responsibleUserId,
      experiencedReviewerUserId,
      participantUserIds,
      participantNames,
      surveyMethod,
      sourceMeasurementDate: entry.target.measurement_date,
      sourceRuleType: calculatedTarget?.kind ?? (entry.plan?.source_rule_type ?? null),
      reason: "찐확정 누락정보 보정", existingPlanId: entry.plan?.id ?? null,
    };
  }));
  const confirmedCount = orderedTargets.filter((target: any) => confirmed.has(journalKey(target))).length;
  return {
    drafts: drafts.sort((left, right) => left.targetId - right.targetId),
    unchangedCount: confirmedCount - missingTargets.length,
    manualReviewCount: drafts.filter((draft) => draft.classification !== "MISSING_DOCUMENTARY_INFO").length,
  };
}
