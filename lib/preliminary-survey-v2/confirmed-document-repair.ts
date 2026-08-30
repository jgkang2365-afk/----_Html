import { calculateV2Recommendations, loadV2ManualContext } from "./service";
import { splitNames } from "../business/link-measurer";
import { validateManualPlanHardRules } from "./manual-validation";
import { createRouteMetrics } from "./route-metrics";
import { recommendationDatesForBusinessType } from "./calendar";
import { buildScheduleBlockKeys } from "./availability";
import { loadActualMeasurementBlockedKeys } from "./measurement-conflicts";
import type { SurveyUser } from "./types";

export type ConfirmedRepairClassification = "COMPLETE" | "MISSING_DOCUMENTARY_INFO" | "PROTECTED_MANUAL" | "NEEDS_MANUAL_REVIEW";

export interface ConfirmedDocumentRepairDraft {
  targetId: number;
  code: string;
  businessName: string;
  classification: ConfirmedRepairClassification;
  fillDate: boolean;
  fillSurveyors: boolean;
  fillMeasurementAssignment: boolean;
  recommendedDate: string | null;
  responsibleUserId: number | null;
  experiencedReviewerUserId: number | null;
  participantUserIds: number[];
  participantNames: string[];
  surveyMethod: "field" | "phone" | null;
  sourceMeasurementDate: string;
  sourceMeasurerId: number | null;
  sourceRuleType: "new" | "existing" | null;
  reason: string;
  existingPlanId: string | null;
  reconciliationId: string | null;
  measurementAssignments: Array<{ measurementDate: string; assigneeUserId: number; surveyCode: string }>;
}

export function classifyConfirmedDocumentState(plan: {
  recommended_date?: string | null;
  participant_user_ids?: unknown;
  participant_names?: unknown;
  responsible_user_id?: number | null;
  experienced_reviewer_id?: number | null;
} | null, protectedSource: boolean, hasMeasurementAssignment = false) {
  const fillDate = !plan?.recommended_date;
  // RPC는 조사자 snapshot의 어느 한 필드라도 존재하면 overwrite를 금지한다.
  // Preview도 같은 경우를 fill 대상으로 내보내지 않아야 한다.
  const hasSurveyorSnapshot = Boolean(
    (Array.isArray(plan?.participant_user_ids) && plan.participant_user_ids.length > 0)
    || (Array.isArray(plan?.participant_names) && plan.participant_names.length > 0)
    || plan?.responsible_user_id != null
    || plan?.experienced_reviewer_id != null,
  );
  const fillSurveyors = !hasSurveyorSnapshot;
  const fillMeasurementAssignment = !hasMeasurementAssignment;
  return {
    fillDate,
    fillSurveyors,
    fillMeasurementAssignment,
    classification: !fillDate && !fillSurveyors && !fillMeasurementAssignment
      ? "COMPLETE" as const
      : protectedSource ? "PROTECTED_MANUAL" as const : "MISSING_DOCUMENTARY_INFO" as const,
  };
}

/** exact legacy 조사자를 보존해야 할 때만, 기존 날짜 정책 후보 안에서 hard rule을 모두 만족하는 첫 날짜를 찾는다. */
export async function firstValidConfirmedRepairDate(input: {
  candidateDates: string[];
  participants: SurveyUser[];
  blockedKeys: Set<string>;
  validate: (date: string) => Promise<{ valid: boolean; errors: string[]; experiencedReviewer: SurveyUser | null }>;
}) {
  const errors: string[] = [];
  for (const date of input.candidateDates) {
    if (input.participants.some((user) => user.active === false || input.blockedKeys.has(`${user.id}:${date}`))) {
      errors.push(`${date}: 조사자 불가 일정 또는 실제 측정 충돌`);
      continue;
    }
    const validation = await input.validate(date);
    if (validation.valid) return { date, validation, errors };
    errors.push(`${date}: ${validation.errors.join(" · ")}`);
  }
  return { date: null, validation: null, errors };
}

function journalKey(row: { code: unknown; year: unknown; period: unknown }) {
  return `${String(row.code)}|${Number(row.year)}|${String(row.period ?? "").trim().replace("(수시)", "")}`;
}

export function hasAuthoritativeBusinessTypePlanMismatch(targetBusinessType: unknown, plan: any) {
  if (!plan || !["existing", "first_measurement", "external_new"].includes(String(targetBusinessType))) return false;
  const expectedRuleType = String(targetBusinessType) === "existing" ? "existing" : "new";
  const expectedSurveyMethod = expectedRuleType === "existing" ? "phone" : "field";
  return (plan.source_rule_type != null && plan.source_rule_type !== expectedRuleType) ||
    (plan.survey_method != null && plan.survey_method !== expectedSurveyMethod);
}

/** 읽기 전용 preview. 일반 추천/apply에 섞지 않는다. */
export async function buildConfirmedDocumentRepairPreview(supabase: any, targetIds: number[]) {
  if (!targetIds.length) return { drafts: [] as ConfirmedDocumentRepairDraft[], unchangedCount: 0, manualReviewCount: 0 };
  const canonicalTargetIds = [...targetIds].sort((left, right) => left - right);
  const { data: targets, error: targetError } = await supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, measurement_date, measurer_id, business_type",
  ).in("id", canonicalTargetIds);
  if (targetError) throw targetError;
  const ids = (targets ?? []).map((target: any) => Number(target.id));
  const codes = [...new Set((targets ?? []).map((target: any) => String(target.code)))];
  const [{ data: plans, error: planError }, { data: journals, error: journalError }, { data: legacyRows, error: legacyError }, { data: reconciliation, error: reconciliationError }] = await Promise.all([
    supabase.from("preliminary_survey_v2_plans").select("*").in("measurement_target_business_id", ids),
    supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", codes),
    supabase.from("preliminary_survey").select("code, year, period, measurement_date, preliminary_surveyor").in("code", codes),
    supabase.from("preliminary_survey_v2_legacy_reconciliation").select(
      "id, measurement_target_business_id, measurement_date, matched_responsible_user_ids, matched_public_sample_user_id, normalized_current_survey_code, rolled_back_at",
    ).in("measurement_target_business_id", ids).is("rolled_back_at", null),
  ]);
  if (planError || journalError || legacyError || reconciliationError) throw planError || journalError || legacyError || reconciliationError;
  const confirmed = new Set((journals ?? []).map((row: any) => journalKey({
    code: row.code, year: row.measurement_year, period: row.measurement_period,
  })));
  const planByTarget = new Map((plans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
  const planIds = (plans ?? []).map((plan: any) => String(plan.id));
  const { data: assignments, error: assignmentError } = planIds.length
    ? await supabase.from("preliminary_survey_v2_measurement_assignments").select("plan_id, measurement_date").in("plan_id", planIds)
    : { data: [], error: null };
  if (assignmentError) throw assignmentError;
  const assignmentKeys = new Set((assignments ?? []).map((assignment: any) => `${assignment.plan_id}|${assignment.measurement_date}`));
  const legacyByTargetKey = new Map((legacyRows ?? []).map((row: any) => [
    `${String(row.code)}|${Number(row.year)}|${String(row.period ?? "").trim().replace("(수시)", "")}|${String(row.measurement_date ?? "")}`,
    row,
  ]));
  const orderedTargets = [...(targets ?? [])].sort((left: any, right: any) => Number(left.id) - Number(right.id));
  const missingTargets = orderedTargets.filter((target: any) => confirmed.has(journalKey(target))).map((target: any) => {
    const plan: any = planByTarget.get(Number(target.id));
    const state = classifyConfirmedDocumentState(plan, false, Boolean(plan && assignmentKeys.has(`${plan.id}|${target.measurement_date}`)));
    return {
      target,
      plan,
      fillDate: state.fillDate,
      fillSurveyors: state.fillSurveyors,
      fillMeasurementAssignment: state.fillMeasurementAssignment,
      protected: false,
      invalidAuthoritativeBusinessType: target.business_type != null && !["existing", "first_measurement", "external_new"].includes(String(target.business_type)),
      businessTypePlanMismatch: hasAuthoritativeBusinessTypePlanMismatch(target.business_type, plan),
    };
  }).filter((entry: any) => entry.fillDate || entry.fillSurveyors || entry.fillMeasurementAssignment || entry.businessTypePlanMismatch);
  const repairableIds = missingTargets.filter((entry: any) =>
    !entry.protected && !entry.invalidAuthoritativeBusinessType && !entry.businessTypePlanMismatch && (entry.plan || entry.target.measurer_id != null),
  ).map((entry: any) => Number(entry.target.id));
  const calculation = repairableIds.length ? await calculateV2Recommendations(supabase, { targetIds: repairableIds }) : null;
  const resultByTarget = new Map((calculation?.results ?? []).map((result) => [result.targetId, result]));
  const targetById = new Map((calculation?.targets ?? []).map((target) => [target.id, target]));
  const drafts: ConfirmedDocumentRepairDraft[] = await Promise.all(missingTargets.map(async (entry: any) => {
    const targetId = Number(entry.target.id);
    const result: any = resultByTarget.get(targetId);
    const calculatedTarget: any = targetById.get(targetId);
    const reconciliationRow: any = (reconciliation ?? []).find((row: any) =>
      Number(row.measurement_target_business_id) === targetId && String(row.measurement_date) === String(entry.target.measurement_date),
    );
    if (entry.invalidAuthoritativeBusinessType) return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
      recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
      participantUserIds: [], participantNames: [], surveyMethod: null,
      sourceMeasurementDate: entry.target.measurement_date, sourceMeasurerId: entry.target.measurer_id ?? null, sourceRuleType: null,
      reason: "측정대상사업장의 business_type 권위값이 유효하지 않아 찐확정 기존값을 자동 변경할 수 없습니다.",
      existingPlanId: entry.plan?.id ?? null, reconciliationId: null, measurementAssignments: [],
    };
    if (entry.businessTypePlanMismatch) return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
      recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
      participantUserIds: [], participantNames: [], surveyMethod: null,
      sourceMeasurementDate: entry.target.measurement_date, sourceMeasurerId: entry.target.measurer_id ?? null, sourceRuleType: null,
      reason: "측정대상사업장의 business_type 권위값과 기존 V2 plan 방식이 다릅니다. 찐확정 non-null 값은 자동 변경할 수 없습니다.",
      existingPlanId: entry.plan?.id ?? null, reconciliationId: null, measurementAssignments: [],
    };
    if (!entry.plan && entry.target.measurer_id == null) return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
      recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
      participantUserIds: [], participantNames: [], surveyMethod: null,
      sourceMeasurementDate: entry.target.measurement_date, sourceMeasurerId: null, sourceRuleType: null,
      reason: "보고서 담당자 원천이 없어 신규 V2 plan의 source snapshot을 구성할 수 없습니다.", existingPlanId: null,
      reconciliationId: null, measurementAssignments: [],
    };
    const legacy: any = legacyByTargetKey.get(
      `${String(entry.target.code)}|${Number(entry.target.year)}|${String(entry.target.period ?? "").trim().replace("(수시)", "")}|${String(entry.target.measurement_date)}`,
    );
    const reconciledIds = Array.isArray(reconciliationRow?.matched_responsible_user_ids)
      ? reconciliationRow.matched_responsible_user_ids.map(Number) : [];
    const legacyNames = entry.fillSurveyors ? splitNames(legacy?.preliminary_surveyor) : [];
    let repairDate = entry.fillDate ? (result?.date ?? null) : entry.plan.recommended_date;
    const surveyMethod = entry.plan?.survey_method ?? result?.surveyMethod ?? null;
    let participantUserIds = entry.fillSurveyors ? (result?.participants ?? []).map((user: any) => user.id) : entry.plan.participant_user_ids.map(Number);
    let participantNames = entry.fillSurveyors ? (result?.participants ?? []).map((user: any) => user.name) : entry.plan.participant_names.map(String);
    let responsibleUserId = entry.plan ? Number(entry.plan.responsible_user_id) : (result?.responsible?.id ?? null);
    let experiencedReviewerUserId = entry.plan?.experienced_reviewer_id ?? result?.experiencedReviewer?.id ?? null;
    if (entry.plan || legacyNames.length || reconciledIds.length) {
      const context = await loadV2ManualContext(supabase, targetId, repairDate ?? entry.target.measurement_date);
      const usersById = new Map<number, SurveyUser>(context.users.map((user: SurveyUser) => [user.id, user]));
      const usersByName = new Map<string, SurveyUser>(context.users.map((user: SurveyUser) => [user.name, user]));
      let participants: Array<SurveyUser | undefined | null> = participantUserIds.map((userId: number) => usersById.get(userId));
      if (entry.fillSurveyors && reconciledIds.length) participants = reconciledIds.map((id: number) => usersById.get(id));
      else if (entry.fillSurveyors && legacyNames.length) participants = legacyNames.map((name) => usersByName.get(name));
      if (entry.plan && entry.fillSurveyors && !reconciledIds.length && !legacyNames.length) {
        const preservedResponsible = usersById.get(Number(entry.plan.responsible_user_id));
        const preservedReviewer = entry.plan.experienced_reviewer_id == null
          ? null : usersById.get(Number(entry.plan.experienced_reviewer_id));
        const recommendedReviewer = result.participants.find((user: any) => user.experienced && user.id !== preservedResponsible?.id);
        participants = [preservedResponsible, preservedReviewer ?? recommendedReviewer].filter(Boolean);
      }
      if (participants.some((user) => !user)) return {
        targetId, code: entry.target.code, businessName: entry.target.business_name,
        classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
        recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
        participantUserIds: [], participantNames: [], surveyMethod: null,
        sourceMeasurementDate: entry.target.measurement_date, sourceMeasurerId: entry.target.measurer_id ?? null, sourceRuleType: calculatedTarget?.kind ?? null,
        reason: legacyNames.length ? "legacy 예비조사자 원천의 사용자 매핑을 확인해야 합니다." : "기존 예비조사자 원천의 사용자 매핑을 확인해야 합니다.",
        existingPlanId: entry.plan?.id ?? null,
        reconciliationId: null, measurementAssignments: [],
      };
      const validParticipants = [...new Map<number, SurveyUser>(participants
        .filter((user): user is SurveyUser => Boolean(user))
        .map((user) => [user.id, user])).values()];
      const responsible = entry.plan ? usersById.get(Number(entry.plan.responsible_user_id)) : validParticipants[0];
      if (!responsible) throw new Error("REPAIR_RESPONSIBLE_MAPPING_FAILED");
      const candidateDates = entry.fillDate
        ? recommendationDatesForBusinessType(
          entry.target.measurement_date,
          context.target.businessType ?? (context.target.kind === "existing" ? "existing" : "first_measurement"),
        ).map((candidate) => candidate.date)
        : [String(repairDate)];
      const candidateRange = [...candidateDates].sort();
      const { data: blocks, error: blockError } = candidateDates.length
        ? await supabase.from("user_schedule_blocks").select("user_id, start_date, end_date")
          .in("user_id", validParticipants.map((user) => user.id))
          .lte("start_date", candidateRange.at(-1)).gte("end_date", candidateRange[0])
        : { data: [], error: null };
      if (blockError) throw blockError;
      const scheduleBlockedKeys = buildScheduleBlockKeys(blocks ?? []);
      const actualMeasurementBlockedKeys = await loadActualMeasurementBlockedKeys(supabase, candidateDates, context.users);
      const blockedKeys = new Set([...scheduleBlockedKeys, ...actualMeasurementBlockedKeys]);
      const selectedDate = await firstValidConfirmedRepairDate({
        candidateDates,
        participants: validParticipants,
        blockedKeys,
        validate: (date) => validateManualPlanHardRules({
          target: { ...context.target, responsible },
          recommendedDate: date,
          participants: validParticipants,
          surveyMethod: surveyMethod ?? (context.target.kind === "new" ? "field" : "phone"),
          existingAssignments: context.assignments,
          routes: createRouteMetrics(),
          experiencedUsers: context.users.filter((user: SurveyUser) => user.experienced),
          availability: {
            isBlocked: (userId, date) => blockedKeys.has(`${userId}:${date}`),
            blockedReason: (userId, date) => {
              const key = `${userId}:${date}`;
              return [
                scheduleBlockedKeys.has(key) ? "USER_SCHEDULE_BLOCK" : null,
                actualMeasurementBlockedKeys.has(key) ? "ACTUAL_MEASUREMENT_CONFLICT" : null,
              ].filter((reason): reason is string => Boolean(reason));
            },
          },
        }),
      });
      if (!selectedDate.date || !selectedDate.validation) return {
        targetId, code: entry.target.code, businessName: entry.target.business_name,
        classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
        recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
        participantUserIds: [], participantNames: [], surveyMethod: null,
        sourceMeasurementDate: entry.target.measurement_date, sourceMeasurerId: entry.target.measurer_id ?? null, sourceRuleType: calculatedTarget?.kind ?? null,
        reason: `보존할 조사자 원천이 정책 후보일의 hard rule을 충족하지 않습니다: ${selectedDate.errors.join(" / ") || "직원 불가 일정"}`,
        existingPlanId: entry.plan?.id ?? null,
        reconciliationId: null, measurementAssignments: [],
      };
      repairDate = selectedDate.date;
      participantUserIds = validParticipants.map((user) => user.id);
      participantNames = validParticipants.map((user) => user.name);
      responsibleUserId = responsible.id;
      experiencedReviewerUserId = entry.plan?.experienced_reviewer_id ?? selectedDate.validation.experiencedReviewer?.id ?? null;
    } else if ((entry.fillDate || !entry.plan) && (!result || result.status !== "recommended" || !result.date)) return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
      recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
      participantUserIds: [], participantNames: [], surveyMethod: null,
      sourceMeasurementDate: entry.target.measurement_date, sourceMeasurerId: entry.target.measurer_id ?? null, sourceRuleType: calculatedTarget?.kind ?? null,
      reason: result?.reason ?? "정책에 맞는 누락정보 보정안을 구성할 수 없습니다.", existingPlanId: entry.plan?.id ?? null,
      reconciliationId: null, measurementAssignments: [],
    };
    const publicSampleUserId = Number(reconciliationRow?.matched_public_sample_user_id);
    const publicSampleCode = String(reconciliationRow?.normalized_current_survey_code ?? "").trim().toUpperCase();
    if (entry.fillMeasurementAssignment && (!reconciliationRow || !Number.isInteger(publicSampleUserId) || !["A", "B", "C", "D", "F", "G"].includes(publicSampleCode))) return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "NEEDS_MANUAL_REVIEW", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
      recommendedDate: null, responsibleUserId: null, experiencedReviewerUserId: null,
      participantUserIds: [], participantNames: [], surveyMethod: null,
      sourceMeasurementDate: entry.target.measurement_date, sourceMeasurerId: entry.target.measurer_id ?? null, sourceRuleType: calculatedTarget?.kind ?? null,
      reason: "정확히 일치하는 공시료 원천 또는 사용자 매핑이 없어 수동 확인이 필요합니다.", existingPlanId: entry.plan?.id ?? null,
      reconciliationId: null, measurementAssignments: [],
    };
    return {
      targetId, code: entry.target.code, businessName: entry.target.business_name,
      classification: "MISSING_DOCUMENTARY_INFO", fillDate: entry.fillDate, fillSurveyors: entry.fillSurveyors, fillMeasurementAssignment: entry.fillMeasurementAssignment,
      recommendedDate: repairDate,
      responsibleUserId,
      experiencedReviewerUserId,
      participantUserIds,
      participantNames,
      surveyMethod,
      sourceMeasurementDate: entry.target.measurement_date,
      sourceMeasurerId: entry.target.measurer_id ?? null,
      sourceRuleType: calculatedTarget?.kind ?? (entry.plan?.source_rule_type ?? null),
      reason: "찐확정 누락정보 보정", existingPlanId: entry.plan?.id ?? null,
      reconciliationId: reconciliationRow ? String(reconciliationRow.id) : null,
      measurementAssignments: entry.fillMeasurementAssignment ? [{ measurementDate: String(entry.target.measurement_date), assigneeUserId: publicSampleUserId, surveyCode: publicSampleCode }] : [],
    };
  }));
  const confirmedCount = orderedTargets.filter((target: any) => confirmed.has(journalKey(target))).length;
  return {
    drafts: drafts.sort((left, right) => left.targetId - right.targetId),
    unchangedCount: confirmedCount - missingTargets.length,
    manualReviewCount: drafts.filter((draft) => draft.classification !== "MISSING_DOCUMENTARY_INFO").length,
  };
}
