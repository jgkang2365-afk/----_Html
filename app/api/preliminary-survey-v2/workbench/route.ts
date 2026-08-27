import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  calculateV2Recommendations,
  loadV2ManualContext,
} from "@/lib/preliminary-survey-v2/service";
import { v2BusinessKindLabel } from "@/lib/preliminary-survey-v2/presentation";
import { parseDateOnly, recommendationDatesForBusinessType } from "@/lib/preliminary-survey-v2/calendar";
import { measurementStaffForDate } from "@/lib/preliminary-survey-v2/measurement-staff";
import { loadActualMeasurementBlockedKeys } from "@/lib/preliminary-survey-v2/measurement-conflicts";
import { storedPlanWorkbenchState } from "@/lib/preliminary-survey-v2/workbench-status";
import { buildScheduleBlockKeys } from "@/lib/preliminary-survey-v2/availability";
import { measurementDayAvailabilityKeys } from "@/lib/business/measurement-day-availability";
import {
  assignMeasurementAssignees,
  buildMeasurementAssignmentTargets,
  collectMeasurementVehicleRouteEvidence,
  MeasurementAssignmentDailyLimitError,
  type ExistingMeasurementAssignment,
  type MeasurementAssignmentTarget,
  type SurveyCode,
} from "@/lib/preliminary-survey-v2/measurement-assignment";
import {
  canonicalizeWorkbenchDraft,
  sameCanonicalWorkbenchDraft,
  type CanonicalMeasurementAssignmentDraft,
  type CanonicalSurveyDraft,
  type RecommendationScopeSnapshot,
} from "@/lib/preliminary-survey-v2/draft-canonical";
import { validateManualPlanHardRules } from "@/lib/preliminary-survey-v2/manual-validation";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import type { ExistingAssignment, SurveyMethod } from "@/lib/preliminary-survey-v2/types";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import {
  calculatePreliminarySurveyImpactScope,
  type PreliminarySurveyImpactScope,
  type PreliminarySurveyImpactTarget,
} from "@/lib/preliminary-survey-v2/impact-scope";
import {
  buildLegacyMeasurementPublicSampleLookup,
  resolveMeasurementPublicSampleDisplay,
} from "@/lib/preliminary-survey-v2/public-sample-display";

export const dynamic = "force-dynamic";

function normalizedPeriod(value: unknown) {
  return String(value ?? "").trim().replace("(수시)", "");
}

function journalKey(code: unknown, year: unknown, period: unknown) {
  return `${code}|${Number(year)}|${normalizedPeriod(period)}`;
}

function routeRegion(address: unknown) {
  const parts = String(address ?? "").trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] || null;
}

function explicitMeasurementDates(target: any): string[] {
  const dailyDates = Array.isArray(target?.daily_staff)
    ? target.daily_staff.map((day: any) => String(day?.date ?? ""))
      .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    : [];
  return [...new Set<string>(dailyDates.length ? dailyDates : [String(target?.measurement_date ?? "")])]
    .filter(Boolean).sort();
}

/** 모든 역할의 직원 제외 일정은 user_schedule_blocks 단일 원천에서 날짜별 key로 읽는다. */
async function loadScheduleBlockKeys(supabase: any, datesInput: readonly string[], userIdsInput?: readonly number[]) {
  const dates = [...new Set(datesInput.filter((date) => parseDateOnly(date)))].sort();
  if (!dates.length) return new Set<string>();
  const userIds = userIdsInput == null ? [] : [...new Set(userIdsInput.filter((id) => Number.isInteger(id) && id > 0))];
  if (userIdsInput != null && !userIds.length) return new Set<string>();
  let query = supabase.from("user_schedule_blocks").select("user_id, start_date, end_date")
    .lte("start_date", dates.at(-1)).gte("end_date", dates[0]);
  if (userIdsInput != null) query = query.in("user_id", userIds);
  const { data, error } = await query;
  if (error) throw error;
  return buildScheduleBlockKeys(data ?? []);
}

function roleIdsForPlan(plan: any): number[] {
  return [...new Set([
    ...(Array.isArray(plan?.participant_user_ids) ? plan.participant_user_ids : []).map(Number),
    Number(plan?.responsible_user_id),
    Number(plan?.experienced_reviewer_id),
  ].filter((id) => Number.isInteger(id) && id > 0))];
}

/** daily_staff를 우선하여 날짜별 보고서 담당자와 실제 측정 참여자를 불가 일정 검증 대상으로 만든다. */
function measurementRoleKeys(target: any, userIdByName: Map<string, number>): string[] {
  return measurementDayAvailabilityKeys({
    dailyStaff: target?.daily_staff,
    measurementDate: target?.measurement_date,
    measurerId: target?.measurer_id,
    collaborators: target?.collaborators,
    userIdByName,
  });
}

async function requireSurveyAccess() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

interface SubmittedDraft {
  targetId: number;
  preliminaryDate: string;
  participantUserIds: number[];
  surveyors: string[];
  surveyMethod: SurveyMethod;
  sourceMeasurementDate: string;
  sourceMeasurerId: number | null;
  sourceResponsibleUserId: number;
  sourceRuleType: "new" | "existing";
  sourceAddress: string | null;
  sourceMeasurementParticipants: string;
  sourcePlanFingerprint: string;
  reason?: string;
  canonicalFingerprint: string;
  recommendationScope: RecommendationScopeSnapshot;
  measurementAssignments: CanonicalMeasurementAssignmentDraft[];
  recommendationReasons?: string[];
}

function parseRecommendationScope(value: any): RecommendationScopeSnapshot | null {
  const result = {
    measurementDateFrom: value?.measurementDateFrom == null ? null : String(value.measurementDateFrom),
    measurementDateTo: value?.measurementDateTo == null ? null : String(value.measurementDateTo),
    preliminaryDateFrom: value?.preliminaryDateFrom == null ? null : String(value.preliminaryDateFrom),
    preliminaryDateTo: value?.preliminaryDateTo == null ? null : String(value.preliminaryDateTo),
  };
  const dates = Object.values(result).filter((date): date is string => date !== null);
  if (dates.some((date) => !parseDateOnly(date)) ||
      (result.measurementDateFrom && result.measurementDateTo && result.measurementDateFrom > result.measurementDateTo) ||
      (result.preliminaryDateFrom && result.preliminaryDateTo && result.preliminaryDateFrom > result.preliminaryDateTo)) return null;
  return result;
}

function isSurveyCode(value: unknown): value is SurveyCode {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F" || value === "G";
}

function measurementAssigneeLabel(name: unknown, surveyCode: unknown) {
  const normalizedName = String(name ?? "").trim();
  const normalizedCode = String(surveyCode ?? "").trim();
  return normalizedName && normalizedCode ? `${normalizedName}(${normalizedCode})` : "-";
}

function parseDraft(value: any): SubmittedDraft | null {
  const participantUserIds = Array.isArray(value?.participantUserIds)
    ? value.participantUserIds.map(Number).filter(Number.isInteger)
    : [];
  const recommendationScope = parseRecommendationScope(value?.recommendationScope);
  const measurementAssignments: CanonicalMeasurementAssignmentDraft[] = Array.isArray(value?.measurementAssignments)
    ? value.measurementAssignments.flatMap((assignment: any) => {
      if (!Number.isInteger(Number(assignment?.targetId)) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(String(assignment?.measurementDate ?? "")) ||
          !Number.isInteger(Number(assignment?.userId)) || !String(assignment?.userName ?? "").trim() ||
          !isSurveyCode(assignment?.surveyCode) || !String(assignment?.reason ?? "").trim()) return [];
      return [{
        targetId: Number(assignment.targetId), measurementDate: String(assignment.measurementDate),
        userId: Number(assignment.userId), userName: String(assignment.userName), surveyCode: assignment.surveyCode,
        approvalRequired: assignment.approvalRequired === true, reason: String(assignment.reason),
      } satisfies CanonicalMeasurementAssignmentDraft];
    }) : [];
  if (!recommendationScope || measurementAssignments.length !== (value?.measurementAssignments?.length ?? 0) ||
      measurementAssignments.some((assignment) => assignment.targetId !== Number(value?.targetId)) ||
      !Number.isInteger(Number(value?.targetId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value?.preliminaryDate ?? "")) ||
      !participantUserIds.length || !Array.isArray(value?.surveyors) ||
      !["field", "phone"].includes(value?.surveyMethod) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(value?.sourceMeasurementDate ?? "")) ||
      !Number.isInteger(Number(value?.sourceResponsibleUserId)) ||
      !/^[a-f0-9]{64}$/i.test(String(value?.sourcePlanFingerprint ?? "")) ||
      !(value?.sourceMeasurerId == null || Number.isInteger(Number(value.sourceMeasurerId))) ||
      !["new", "existing"].includes(value?.sourceRuleType) ||
      !/^[a-f0-9]{64}$/i.test(String(value?.canonicalFingerprint ?? ""))) return null;
  return {
    targetId: Number(value.targetId),
    preliminaryDate: String(value.preliminaryDate),
    participantUserIds: [...new Set<number>(participantUserIds)],
    surveyors: value.surveyors.map(String),
    surveyMethod: value.surveyMethod,
    sourceMeasurementDate: String(value.sourceMeasurementDate),
    sourceMeasurerId: value.sourceMeasurerId == null ? null : Number(value.sourceMeasurerId),
    sourceResponsibleUserId: Number(value.sourceResponsibleUserId),
    sourceRuleType: value.sourceRuleType,
    sourceAddress: value.sourceAddress == null ? null : String(value.sourceAddress),
    sourceMeasurementParticipants: String(value.sourceMeasurementParticipants ?? "-"),
    sourcePlanFingerprint: String(value.sourcePlanFingerprint),
    reason: typeof value.reason === "string" ? value.reason : undefined,
    canonicalFingerprint: String(value.canonicalFingerprint),
    recommendationScope,
    measurementAssignments,
    recommendationReasons: Array.isArray(value.recommendationReasons) ? value.recommendationReasons.map(String) : [],
  };
}

function isMeasurementAssignmentSchemaMissing(error: any) {
  return ["42P01", "PGRST202", "PGRST205"].includes(String(error?.code ?? "")) ||
    /preliminary_survey_v2_measurement_assignments|persist_preliminary_survey_v2_plan_and_assignment_groups/i.test(String(error?.message ?? ""));
}

function isLegacyReconciliationSchemaMissing(error: any) {
  return ["42P01", "PGRST202", "PGRST205", "42703"].includes(String(error?.code ?? "")) ||
    /preliminary_survey_v2_legacy_reconciliation/i.test(String(error?.message ?? ""));
}

function canonicalFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** SQL RPC와 같은 입력 순서로 3건 승인 그룹을 식별한다. */
function measurementAssignmentApprovalGroupFingerprint(
  measurementDate: string,
  userId: number,
  targetIds: readonly number[],
) {
  return createHash("md5")
    .update(`${measurementDate}|${userId}|${[...targetIds].sort((left, right) => left - right).join(",")}`)
    .digest("hex");
}

function thirdAssignmentApprovalGroupFingerprints(assignments: Array<{
  targetId: number;
  measurementDate: string;
  userId: number;
}>) {
  const targetIdsByGroup = new Map<string, number[]>();
  for (const assignment of assignments) {
    const key = `${assignment.measurementDate}|${assignment.userId}`;
    targetIdsByGroup.set(key, [...(targetIdsByGroup.get(key) ?? []), assignment.targetId]);
  }
  return [...targetIdsByGroup.entries()].flatMap(([key, targetIds]) => {
    const [measurementDate, userId] = key.split("|");
    const uniqueTargetIds = [...new Set(targetIds)].sort((left, right) => left - right);
    return uniqueTargetIds.length === 3
      ? [measurementAssignmentApprovalGroupFingerprint(measurementDate, Number(userId), uniqueTargetIds)] : [];
  });
}

function sourcePlanFingerprint(target: Awaited<ReturnType<typeof calculateV2Recommendations>>["targets"][number]) {
  return canonicalFingerprint({
    address: target.address ?? null,
    measurementDate: target.measurementDate,
    measurementAssignmentDates: target.measurementAssignmentDates ?? null,
    sourceMeasurerId: target.sourceMeasurerId ?? null,
    dailyStaff: target.sourceDailyStaffSnapshot ?? null,
    collaborators: target.sourceCollaboratorsSnapshot ?? null,
    businessType: target.businessType ?? null,
  });
}

function canonicalSurveySnapshot(output: Awaited<ReturnType<typeof calculateV2Recommendations>>): CanonicalSurveyDraft[] {
  return output.results.map((result) => {
    const target = output.targets.find((item) => item.id === result.targetId)!;
    return {
      targetId: result.targetId,
      preliminaryDate: result.date,
      participantUserIds: result.participants.map((user) => user.id),
      surveyors: result.participants.map((user) => user.name),
      surveyMethod: result.surveyMethod,
      sourceMeasurementDate: target.measurementDate,
      sourceMeasurerId: target.sourceMeasurerId ?? null,
      sourceResponsibleUserId: result.responsible.id,
      sourceRuleType: target.kind,
      sourceAddress: target.address,
      sourceMeasurementParticipants: target.measurementParticipantsSnapshot ?? "-",
      sourcePlanFingerprint: sourcePlanFingerprint(target),
      reason: result.reason ?? null,
    };
  }).sort((left, right) => left.targetId - right.targetId);
}

interface CanonicalMeasurementAssignment {
  targetId: number;
  measurementDate: string;
  userId: number;
  userName: string;
  surveyCode: SurveyCode;
  approvalRequired: boolean;
  reason: string;
}

async function recomputeCanonicalMeasurementAssignments(
  supabase: any,
  contexts: Awaited<ReturnType<typeof loadV2ManualContext>>[],
  submitted: SubmittedDraft[],
) {
  const [{ data: assigneeUsers, error: assigneeUserError }, { data: persisted, error: persistedError }] = await Promise.all([
    supabase.from("users").select("id, name, is_active, survey_code").eq("is_active", true).not("survey_code", "is", null),
    supabase.from("preliminary_survey_v2_measurement_assignments").select(
      "plan_id, measurement_date, assignee_user_id, approval_required, approval_group_fingerprint",
    ),
  ]);
  if (persistedError && isMeasurementAssignmentSchemaMissing(persistedError)) return { schemaMissing: true as const };
  if (assigneeUserError || persistedError) throw assigneeUserError || persistedError;

  const persistedPlanIds = [...new Set((persisted ?? []).map((item: any) => String(item.plan_id)))];
  const { data: persistedPlans, error: persistedPlanError } = persistedPlanIds.length
    ? await supabase.from("preliminary_survey_v2_plans").select("id, measurement_target_business_id").in("id", persistedPlanIds)
    : { data: [], error: null };
  if (persistedPlanError) throw persistedPlanError;
  const submittedIds = new Set(submitted.map((draft) => draft.targetId));
  const existingTargetIds = [...new Set((persistedPlans ?? [])
    .map((plan: any) => Number(plan.measurement_target_business_id))
    .filter((businessId: number) => !submittedIds.has(businessId)))];
  const { data: existingTargets, error: existingTargetError } = existingTargetIds.length
    ? await supabase.from("measurement_target_business").select("id, code, address").in("id", existingTargetIds)
    : { data: [], error: null };
  if (existingTargetError) throw existingTargetError;
  const existingCodes = [...new Set((existingTargets ?? []).map((target: any) => target.code).filter(Boolean))];
  const { data: existingBusinessInfo, error: existingBusinessInfoError } = existingCodes.length
    ? await supabase.from("business_info").select("code, latitude, longitude").in("code", existingCodes)
    : { data: [], error: null };
  if (existingBusinessInfoError) throw existingBusinessInfoError;
  const planById = new Map((persistedPlans ?? []).map((plan: any) => [String(plan.id), plan]));
  const existingById = new Map((existingTargets ?? []).map((target: any) => [Number(target.id), target]));
  const infoByCode = new Map((existingBusinessInfo ?? []).map((info: any) => [info.code, info]));
  const existing: ExistingMeasurementAssignment[] = (persisted ?? []).flatMap((item: any) => {
    const plan: any = planById.get(String(item.plan_id));
    const target: any = existingById.get(Number(plan?.measurement_target_business_id));
    const info: any = infoByCode.get(target?.code);
    if (!target || !item.measurement_date) return [];
    return [{
      targetId: Number(plan.measurement_target_business_id),
      measurementDate: String(item.measurement_date),
      address: target.address ?? null,
      businessCode: target.code,
      region: routeRegion(target.address),
      coordinate: Number.isFinite(Number(info?.latitude)) && Number.isFinite(Number(info?.longitude))
        ? { latitude: Number(info.latitude), longitude: Number(info.longitude) } : null,
      userId: Number(item.assignee_user_id),
    }];
  });
  const incompleteTargetIds = contexts.filter((context) => !context.target.measurementAssignmentDates?.length)
    .map((context) => context.target.id);
  const submittedByTargetId = new Map(submitted.map((draft) => [draft.targetId, draft]));
  const assignmentTargets: MeasurementAssignmentTarget[] = contexts.flatMap((context) =>
    buildMeasurementAssignmentTargets({
      target: context.target,
      preliminarySurveyorUserId: submittedByTargetId.get(context.target.id)?.sourceResponsibleUserId ?? null,
    }));
  const assigneeBlockKeys = await loadScheduleBlockKeys(
    supabase,
    assignmentTargets.map((target) => target.measurementDate),
    (assigneeUsers ?? []).map((user: any) => Number(user.id)),
  );
  const assigneeCapacity = (assigneeUsers ?? []).filter((user: any) => isSurveyCode(String(user.survey_code ?? "").trim().toUpperCase())).length;
  const routeNeededDates = new Set(assigneeCapacity > 0 ? [...new Set(assignmentTargets.map((target) => target.measurementDate))].filter((date) =>
    assignmentTargets.filter((target) => target.measurementDate === date).length +
      existing.filter((target) => target.measurementDate === date).length > assigneeCapacity,
  ) : []);
  const routeEvidence = await collectMeasurementVehicleRouteEvidence({
    targets: assignmentTargets.filter((target) => routeNeededDates.has(target.measurementDate)),
    existing: existing.filter((target) => routeNeededDates.has(target.measurementDate)),
    routes: createRouteMetrics(),
  });
  const assignments = assignMeasurementAssignees({
    targets: assignmentTargets,
    users: (assigneeUsers ?? []).map((user: any) => ({
      id: Number(user.id), name: user.name, active: user.is_active, surveyCode: user.survey_code,
    })),
    existing,
    routeEvidence,
    availability: { isBlocked: (userId, date) => assigneeBlockKeys.has(`${userId}:${date}`) },
  });
  const proposedMeasurementDates = new Set(assignmentTargets.map((target) => target.measurementDate));
  const baseline = existing.filter((assignment) => proposedMeasurementDates.has(assignment.measurementDate)).map((assignment) => ({
    targetId: assignment.targetId,
    measurementDate: assignment.measurementDate,
    userId: assignment.userId,
  })).sort((left, right) => left.targetId - right.targetId ||
    left.measurementDate.localeCompare(right.measurementDate) || left.userId - right.userId);
  const userById = new Map((assigneeUsers ?? []).map((user: any) => [Number(user.id), user]));
  const invalidSurveyCodeUserIds: number[] = [];
  const canonical = assignments.flatMap((assignment) => {
    const user: any = userById.get(assignment.userId);
    const surveyCode = String(user?.survey_code ?? "").trim().toUpperCase();
    if (!isSurveyCode(surveyCode)) {
      invalidSurveyCodeUserIds.push(assignment.userId);
      return [];
    }
    return [{
      targetId: assignment.targetId,
      measurementDate: assignment.measurementDate,
      userId: assignment.userId,
      userName: assignment.userName,
      surveyCode,
      approvalRequired: assignment.approvalRequired,
      reason: assignment.reason,
    } satisfies CanonicalMeasurementAssignment];
  });
  const approvedGroupFingerprints = new Set((persisted ?? []).flatMap((assignment: any) =>
    assignment.approval_required === true && typeof assignment.approval_group_fingerprint === "string" &&
      /^[a-f0-9]{32}$/i.test(assignment.approval_group_fingerprint)
      ? [assignment.approval_group_fingerprint] : [],
  ));
  return {
    schemaMissing: false as const,
    canonical,
    baseline,
    approvedGroupFingerprints,
    invalidSurveyCodeUserIds,
    incompleteTargetIds,
  };
}

async function applySubmittedDrafts(
  supabase: any,
  rawDrafts: unknown[],
  approveThirdAssignment: boolean,
  approvedByUserId: number,
) {
  const drafts = rawDrafts.map(parseDraft);
  if (!drafts.length || drafts.some((draft) => !draft)) {
    return NextResponse.json({ error: "적용할 추천안 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const submitted = drafts as SubmittedDraft[];
  if (new Set(submitted.map((draft) => draft.targetId)).size !== submitted.length) {
    return NextResponse.json({ error: "중복된 추천안이 포함되어 있습니다." }, { status: 400 });
  }
  const recommendationScope = submitted[0].recommendationScope;
  if (submitted.some((draft) => JSON.stringify(draft.recommendationScope) !== JSON.stringify(recommendationScope))) {
    return NextResponse.json({ error: "서로 다른 추천 범위의 draft를 함께 적용할 수 없습니다." }, { status: 400 });
  }
  const recalculated = await calculateV2Recommendations(supabase, {
    targetIds: submitted.map((draft) => draft.targetId),
    measurementDateFrom: recommendationScope.measurementDateFrom ?? undefined,
    measurementDateTo: recommendationScope.measurementDateTo ?? undefined,
    preliminaryDateFrom: recommendationScope.preliminaryDateFrom ?? undefined,
    preliminaryDateTo: recommendationScope.preliminaryDateTo ?? undefined,
  });
  const canonicalSurvey = canonicalSurveySnapshot(recalculated);
  const submittedSurvey = submitted.map((draft) => ({
    targetId: draft.targetId,
    preliminaryDate: draft.preliminaryDate,
    participantUserIds: draft.participantUserIds,
    surveyors: draft.surveyors,
    surveyMethod: draft.surveyMethod,
    sourceMeasurementDate: draft.sourceMeasurementDate,
    sourceMeasurerId: draft.sourceMeasurerId,
    sourceResponsibleUserId: draft.sourceResponsibleUserId,
    sourceRuleType: draft.sourceRuleType,
    sourceAddress: draft.sourceAddress,
    sourceMeasurementParticipants: draft.sourceMeasurementParticipants,
    sourcePlanFingerprint: draft.sourcePlanFingerprint,
    reason: draft.reason ?? null,
  })).sort((left, right) => left.targetId - right.targetId);
  let contexts: Awaited<ReturnType<typeof loadV2ManualContext>>[];
  try {
    contexts = await Promise.all(submitted.map((draft) =>
      loadV2ManualContext(supabase, draft.targetId, draft.preliminaryDate)));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "DRAFT_SOURCE_CHANGED";
    return NextResponse.json({
      error: "추천 생성 후 사업장 또는 연계측정자 정보가 변경되어 저장하지 않았습니다.",
      code: "DRAFT_REVIEW_REQUIRED",
      reviewRequired: true,
      reasons: submitted.map((draft) => ({ targetId: draft.targetId, reason })),
    }, { status: 409 });
  }
  const draftIds = new Set(submitted.map((draft) => draft.targetId));
  const codes = [...new Set(contexts.map((context) => context.target.code))];
  const { data: journals, error: journalError } = codes.length
    ? await supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", codes)
    : { data: [], error: null };
  if (journalError) throw journalError;
  const lockedKeys = new Set((journals ?? []).map((row: any) =>
    journalKey(row.code, row.measurement_year, row.measurement_period)));
  const dates = [...new Set(submitted.map((draft) => draft.preliminaryDate))].sort();
  const participantIds = [...new Set(submitted.flatMap((draft) => [
    ...draft.participantUserIds,
    draft.sourceResponsibleUserId,
  ]))];
  const allUsers = contexts[0]?.users ?? [];
  const userIdByName = new Map(allUsers.map((user) => [user.name.trim(), user.id]));
  const measurementRoleKeysByTarget = new Map(contexts.map((context) => [
    context.target.id,
    measurementRoleKeys({
      daily_staff: context.target.sourceDailyStaffSnapshot,
      measurement_date: context.target.measurementDate,
      measurer_id: context.target.sourceMeasurerId,
      collaborators: context.target.sourceCollaboratorsSnapshot,
    }, userIdByName),
  ]));
  const measurementRoleKeysAll = [...measurementRoleKeysByTarget.values()].flat();
  const measurementRoleDates = measurementRoleKeysAll.map((key) => key.slice(key.indexOf(":") + 1));
  const measurementRoleUserIds = measurementRoleKeysAll.map((key) => Number(key.slice(0, key.indexOf(":"))));
  const [scheduleBlockedKeys, measurementRoleBlockedKeys, measurementBlockedKeys] = await Promise.all([
    loadScheduleBlockKeys(supabase, dates, participantIds),
    loadScheduleBlockKeys(supabase, measurementRoleDates, measurementRoleUserIds),
    loadActualMeasurementBlockedKeys(supabase, dates, allUsers),
  ]);
  const blockedKeys = new Set(measurementBlockedKeys);
  for (const key of scheduleBlockedKeys) blockedKeys.add(key);
  const reasons: Array<{ targetId: number; reason: string }> = [];
  const routes = createRouteMetrics();
  const draftAssignments: ExistingAssignment[] = submitted.map((draft, index) => {
    const context = contexts[index];
    const participants = draft.participantUserIds.flatMap((id) => context.users.find((user) => user.id === id) ?? []);
    const responsible = participants.find((user) => user.id === draft.sourceResponsibleUserId) ?? participants[0];
    const reviewer = participants.find((user) => user.id !== responsible?.id && user.experienced) ?? null;
    return {
      targetId: draft.targetId,
      businessCode: context.target.code,
      kind: context.target.kind,
      date: draft.preliminaryDate,
      participants: draft.participantUserIds,
      responsibleUserId: responsible?.id ?? draft.sourceResponsibleUserId,
      experiencedReviewerId: reviewer?.id ?? null,
      coordinate: context.target.coordinate,
      region: context.target.region,
    };
  });

  const validations = await Promise.all(submitted.map(async (draft, index) => {
    const context = contexts[index];
    const participants = draft.participantUserIds.flatMap((id) => context.users.find((user) => user.id === id) ?? []);
    const responsible = participants.find((user) => user.id === draft.sourceResponsibleUserId);
    const currentNames = participants.map((user) => user.name);
    if (lockedKeys.has(journalKey(context.target.code, context.target.classificationSource?.measurementYear, context.target.classificationSource?.measurementPeriod))) {
      reasons.push({ targetId: draft.targetId, reason: "유효한 측정일지가 생성되어 찐확정되었습니다." });
    }
    if (context.target.measurementDate !== draft.sourceMeasurementDate || context.target.sourceMeasurerId !== draft.sourceMeasurerId ||
        context.target.kind !== draft.sourceRuleType || context.target.address !== draft.sourceAddress ||
        context.target.measurementParticipantsSnapshot !== draft.sourceMeasurementParticipants) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 측정계획 또는 업체 구분이 변경되었습니다." });
    }
    if (participants.length !== draft.participantUserIds.length || currentNames.join("|") !== draft.surveyors.join("|")) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 조사자 정보가 변경되었습니다." });
    }
    if (context.target.kind === "new" && draft.surveyMethod !== "field") {
      reasons.push({ targetId: draft.targetId, reason: "신규업체는 현장 예비조사 방식이어야 합니다." });
    }
    const validation = await validateManualPlanHardRules({
      target: { ...context.target, responsible: responsible ?? context.target.responsible },
      recommendedDate: draft.preliminaryDate,
      participants,
      surveyMethod: draft.surveyMethod,
      existingAssignments: [
        ...context.assignments.filter((assignment) => !draftIds.has(assignment.targetId)),
        ...draftAssignments.filter((assignment) => assignment.targetId !== draft.targetId),
      ],
      routes,
    });
    const roleUserIds = [...new Set([
      ...draft.participantUserIds,
      draft.sourceResponsibleUserId,
      validation.experiencedReviewer?.id,
    ].filter((id): id is number => id != null && Number.isInteger(id) && id > 0))];
    if (participants.some((user) => user.active === false) || roleUserIds.some((id) => blockedKeys.has(`${id}:${draft.preliminaryDate}`))) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 조사자 제외 일정 또는 측정 업무가 추가되었습니다." });
    }
    if ((measurementRoleKeysByTarget.get(draft.targetId) ?? [])
      .some((key) => measurementRoleBlockedKeys.has(key))) {
      reasons.push({ targetId: draft.targetId, reason: "측정일의 보고서 담당자 또는 측정 참여자에게 직원 불가 일정이 추가되었습니다." });
    }
    for (const reason of validation.errors) reasons.push({ targetId: draft.targetId, reason });
    return { validation, participants, responsible };
  }));

  if (reasons.length) {
    return NextResponse.json({
      error: "추천안의 전제 조건이 변경되어 저장하지 않았습니다. 새 추천이 필요합니다.",
      code: "DRAFT_REVIEW_REQUIRED",
      reviewRequired: true,
      reasons,
    }, { status: 409 });
  }

  // client가 보낸 assignee/code/3건 승인여부는 저장 근거가 아니다. 현 DB의 날짜별
  // assignment와 users.survey_code로 다시 계산해 draft와 완전히 같을 때만 적용한다.
  const canonicalResult = await recomputeCanonicalMeasurementAssignments(supabase, contexts, submitted);
  if (canonicalResult.schemaMissing) {
    return NextResponse.json({
      error: "측정자·공시료 배정 스키마가 아직 적용되지 않았습니다. 마이그레이션 적용 후 새 추천안을 생성해 주세요.",
      code: "MEASUREMENT_ASSIGNMENT_SCHEMA_REQUIRED",
      reviewRequired: true,
    }, { status: 409 });
  }
  if (canonicalResult.invalidSurveyCodeUserIds.length) {
    return NextResponse.json({
      error: "배정 대상 측정자의 공시료 코드가 사용자 정보에 설정되어 있지 않습니다.",
      code: "MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED",
      reviewRequired: true,
    }, { status: 409 });
  }
  if (canonicalResult.incompleteTargetIds.length) {
    return NextResponse.json({
      error: "다일 측정의 날짜별 daily_staff 정보가 불완전하여 측정자 배정을 적용할 수 없습니다.",
      code: "MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE",
      reviewRequired: true,
      reasons: canonicalResult.incompleteTargetIds.map((targetId) => ({ targetId, reason: "다일 측정 날짜별 인력 정보 필요" })),
    }, { status: 409 });
  }
  const serverCanonical = canonicalizeWorkbenchDraft({
    scope: recommendationScope,
    surveys: canonicalSurvey,
    measurementAssignments: canonicalResult.canonical.map((assignment) => ({ ...assignment })),
  });
  const submittedCanonical = canonicalizeWorkbenchDraft({
    scope: recommendationScope,
    surveys: submittedSurvey,
    measurementAssignments: submitted.flatMap((draft) => draft.measurementAssignments),
  });
  const expectedFingerprint = canonicalFingerprint(serverCanonical);
  if (canonicalSurvey.length !== submitted.length ||
      submitted.some((draft) => draft.canonicalFingerprint !== expectedFingerprint) ||
      !sameCanonicalWorkbenchDraft(serverCanonical, submittedCanonical)) {
    return NextResponse.json({
      error: "추천안을 서버에서 재계산한 결과와 사용자가 확인한 전체 draft가 일치하지 않습니다. 새 추천안을 검토해 주세요.",
      code: "DRAFT_REVIEW_REQUIRED",
      reviewRequired: true,
    }, { status: 409 });
  }
  const approvalGroupFingerprints = thirdAssignmentApprovalGroupFingerprints([
    ...canonicalResult.baseline,
    ...canonicalResult.canonical,
  ]);
  const needsThirdAssignmentApproval = approvalGroupFingerprints
    .some((fingerprint) => !canonicalResult.approvedGroupFingerprints.has(fingerprint));
  if (needsThirdAssignmentApproval && !approveThirdAssignment) {
    return NextResponse.json({
      error: "측정자 1인 3건 배정이 포함되어 예비조사 담당자 또는 관리자 승인이 필요합니다.",
      code: "MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED",
      approvalRequired: true,
    }, { status: 409 });
  }

  const payload = submitted.map((draft, index) => {
    const { validation, participants, responsible } = validations[index];
    return {
      measurement_target_business_id: draft.targetId,
      recommended_date: draft.preliminaryDate,
      responsible_user_id: responsible!.id,
      experienced_reviewer_id: validation.experiencedReviewer?.id ?? null,
      participant_user_ids: draft.participantUserIds,
      participant_names: participants.map((user) => user.name),
      status: "recommended",
      plan_origin: "manual",
      source_measurement_date: draft.sourceMeasurementDate,
      source_address: contexts[index].target.address ?? null,
      source_daily_staff: contexts[index].target.sourceDailyStaffSnapshot ?? null,
      source_collaborators: contexts[index].target.sourceCollaboratorsSnapshot ?? null,
      source_responsible_user_id: draft.sourceMeasurerId,
      source_rule_type: draft.sourceRuleType,
      survey_method: draft.surveyMethod,
      recommendation_reason: {
        reason: canonicalSurvey.find((item) => item.targetId === draft.targetId)!.reason,
        shortReasons: [],
        sourceContext: {
          address: draft.sourceAddress,
          measurementParticipants: draft.sourceMeasurementParticipants,
        },
      },
      route_evidence: { validatedAtApply: true },
      warnings: [],
    };
  });
  const assignmentPayload = canonicalResult.canonical.map((assignment) => ({
    measurement_target_business_id: assignment.targetId,
    measurement_date: assignment.measurementDate,
    assignee_user_id: assignment.userId,
    survey_code: assignment.surveyCode,
    assignment_reason: assignment.reason,
  }));
  const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan_and_assignment_groups", {
    p_plans: payload,
    p_assignments: assignmentPayload,
    p_assignment_baseline: canonicalResult.baseline,
    p_approve_third_assignment: approveThirdAssignment,
    p_approved_by_user_id: approveThirdAssignment ? approvedByUserId : null,
  });
  if (error) {
    if (isMeasurementAssignmentSchemaMissing(error)) {
      return NextResponse.json({
        error: "측정자·공시료 배정 스키마가 아직 적용되지 않았습니다. 마이그레이션 적용 후 새 추천안을 생성해 주세요.",
        code: "MEASUREMENT_ASSIGNMENT_SCHEMA_REQUIRED",
        reviewRequired: true,
      }, { status: 409 });
    }
    const rpcMessage = String(error.message || "저장 직전 원천값이 변경되어 저장하지 않았습니다. 새 추천이 필요합니다.");
    return NextResponse.json({
      error: rpcMessage,
      code: rpcMessage.includes("MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED")
        ? "MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED"
        : rpcMessage.includes("TRUE_CONFIRMED_LOCKED") ? "TRUE_CONFIRMED_LOCKED" : "DRAFT_REVIEW_REQUIRED",
      reviewRequired: true,
    }, { status: 409 });
  }
  return NextResponse.json({ success: true, appliedCount: Array.isArray(data) ? data.length : 0, appliedDrafts: submitted });
}

export async function GET(request: NextRequest) {
  try {
    await requireSurveyAccess();
    const params = new URL(request.url).searchParams;
    const year = Number(params.get("year") || new Date().getFullYear());
    const period = params.get("period") || "";
    const supabase = await createClient();

    let targetQuery = supabase.from("measurement_target_business").select(
      "id, code, year, period, business_name, address, measurement_date, business_type, preliminary_survey_rule_type, collaborators, daily_staff, measurer_id, link_measurer_id",
    ).eq("year", year).order("measurement_date", { ascending: true });
    if (period) targetQuery = targetQuery.eq("period", period);
    const { data: targets, error: targetError } = await targetQuery;
    if (targetError) throw targetError;

    const targetIds = (targets ?? []).map((target: any) => Number(target.id));
    const codes = [...new Set((targets ?? []).map((target: any) => target.code))];
    const [{ data: plans, error: planError }, { data: journals, error: journalError }, { data: users, error: userError }, { data: scheduleBlocks, error: scheduleBlockError }, { data: legacySurveys, error: legacySurveyError }] = await Promise.all([
      targetIds.length
        ? supabase.from("preliminary_survey_v2_plans").select("*").in("measurement_target_business_id", targetIds)
        : Promise.resolve({ data: [], error: null }),
      codes.length
        ? supabase.from("measurement_journal").select("id, code, measurement_year, measurement_period").in("code", codes)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("users").select("id, name, is_active, is_preliminary_survey_experienced, job").eq("job", "측정"),
      supabase.from("user_schedule_blocks").select("user_id, start_date, end_date"),
      codes.length
        ? supabase.from("preliminary_survey").select(
          "code, year, period, measurement_date, measurer, survey_code",
        ).in("code", codes).eq("year", year)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (planError || journalError || userError || scheduleBlockError || legacySurveyError) {
      throw planError || journalError || userError || scheduleBlockError || legacySurveyError;
    }

    // migration 전에는 기존 plan snapshot을 읽기 fallback으로만 사용한다. POST apply는
    // fallback 저장을 허용하지 않고 새 원자 RPC를 요구한다.
    const { data: assignmentRows, error: assignmentError } = targetIds.length
      ? await supabase.from("preliminary_survey_v2_measurement_assignments").select(
        "id, plan_id, measurement_date, assignee_user_id, survey_code, approval_required",
      )
      : { data: [], error: null };
    if (assignmentError && !isMeasurementAssignmentSchemaMissing(assignmentError)) throw assignmentError;

    // 배포와 migration의 순서를 분리하기 위해 신규 snapshot table이 아직 없으면 live fallback만 유지한다.
    const { data: reconciliationRows, error: reconciliationError } = targetIds.length
      ? await supabase.from("preliminary_survey_v2_legacy_reconciliation").select(
        "measurement_target_business_id, measurement_date, legacy_public_sample_measurer, legacy_survey_code_raw, applied_assignment_id",
      ).in("measurement_target_business_id", targetIds)
      : { data: [], error: null };
    if (reconciliationError && !isLegacyReconciliationSchemaMissing(reconciliationError)) throw reconciliationError;

    const planByTarget = new Map((plans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    const userNameById = new Map((users ?? []).map((user: any) => [Number(user.id), user.name]));
    const userIdByName = new Map((users ?? []).map((user: any) => [String(user.name ?? "").trim(), Number(user.id)]));
    const planTargetById = new Map((plans ?? []).map((plan: any) => [String(plan.id), Number(plan.measurement_target_business_id)]));
    const assignmentByTargetDate = new Map((assignmentRows ?? []).flatMap((assignment: any) => {
      const businessId = planTargetById.get(String(assignment.plan_id));
      return businessId == null ? [] : [[`${businessId}|${String(assignment.measurement_date)}`, assignment] as const];
    }));
    const reconciliationByTargetDate = new Map((reconciliationRows ?? []).map((row: any) => [
      `${Number(row.measurement_target_business_id)}|${String(row.measurement_date)}`,
      {
        measurer: row.legacy_public_sample_measurer == null ? null : String(row.legacy_public_sample_measurer),
        surveyCode: row.legacy_survey_code_raw == null ? null : String(row.legacy_survey_code_raw),
        appliedAssignmentId: row.applied_assignment_id == null ? null : String(row.applied_assignment_id),
      },
    ]));
    const assignmentsByTarget = new Map<number, any[]>();
    for (const assignment of assignmentRows ?? []) {
      const targetId = planTargetById.get(String(assignment.plan_id));
      if (targetId == null) continue;
      assignmentsByTarget.set(targetId, [...(assignmentsByTarget.get(targetId) ?? []), assignment]);
    }
    const confirmedKeys = new Set((journals ?? []).map((row: any) =>
      journalKey(row.code, row.measurement_year, row.measurement_period),
    ));
    const legacyMeasurementPublicSampleForTarget = buildLegacyMeasurementPublicSampleLookup(
      (legacySurveys ?? []).map((row: any) => ({
        code: String(row.code ?? ""), year: Number(row.year), period: String(row.period ?? ""),
        measurementDate: String(row.measurement_date ?? ""),
        measurer: row.measurer == null ? null : String(row.measurer),
        surveyCode: row.survey_code == null ? null : String(row.survey_code),
      })),
    );
    const scheduleBlockedKeys = buildScheduleBlockKeys(scheduleBlocks ?? []);

    const rows = (targets ?? []).map((target: any) => {
      const plan: any = planByTarget.get(Number(target.id)) ?? null;
      const trueConfirmed = confirmedKeys.has(journalKey(target.code, target.year, target.period));
      const staff = measurementStaffForDate({
        dailyStaff: target.daily_staff,
        measurementDate: target.measurement_date,
        collaborators: target.collaborators,
        userNameById,
      });
      const sourceContext = plan?.recommendation_reason?.sourceContext;
      const stale = Boolean(plan && (
        plan.source_measurement_date !== target.measurement_date ||
        plan.source_responsible_user_id !== target.measurer_id ||
        (sourceContext && (
          sourceContext.address !== target.address ||
          sourceContext.measurementParticipants !== staff.measurementParticipants
        ))
      ));
      const preliminaryScheduleBlocked = Boolean(plan?.recommended_date) && roleIdsForPlan(plan)
        .some((userId) => scheduleBlockedKeys.has(`${userId}:${plan.recommended_date}`));
      const measurementScheduleBlocked = (assignmentsByTarget.get(Number(target.id)) ?? []).some((assignment: any) =>
        scheduleBlockedKeys.has(`${Number(assignment.assignee_user_id)}:${String(assignment.measurement_date)}`),
      );
      const measurementRoleScheduleBlocked = measurementRoleKeys(target, userIdByName)
        .some((key) => scheduleBlockedKeys.has(key));
      const presentationState = storedPlanWorkbenchState({
        trueConfirmed,
        stale,
        hasPlan: Boolean(plan),
        planOrigin: plan?.plan_origin ?? null,
        planStatus: plan?.status ?? null,
        preliminaryScheduleBlocked,
        measurementScheduleBlocked,
        measurementRoleScheduleBlocked,
      });
      const kind = target.business_type === "external_new"
        ? "타기관 신규"
        : target.business_type === "first_measurement"
          ? "최초실시"
          : target.business_type === "existing"
            ? "기존업체"
            : v2BusinessKindLabel(plan?.source_rule_type ?? target.preliminary_survey_rule_type ?? "existing", plan?.recommendation_reason ?? null);
      const persistedAssignment: any = assignmentByTargetDate.get(`${Number(target.id)}|${String(target.measurement_date)}`) ?? null;
      const legacyMeasurementPublicSample = legacyMeasurementPublicSampleForTarget({
        code: String(target.code ?? ""), year: Number(target.year), period: String(target.period ?? ""),
        measurementDate: String(target.measurement_date ?? ""),
      });
      const measurementAssigneeDisplay = resolveMeasurementPublicSampleDisplay({
        v2Assignment: persistedAssignment ? {
          assigneeUserId: Number(persistedAssignment.assignee_user_id),
          surveyCode: persistedAssignment.survey_code == null ? null : String(persistedAssignment.survey_code),
        } : null,
        v2AssignmentId: persistedAssignment?.id == null ? null : String(persistedAssignment.id),
        reconciliation: reconciliationByTargetDate.get(
          `${Number(target.id)}|${String(target.measurement_date)}`,
        ) ?? null,
        trueConfirmed,
        legacyAssignment: legacyMeasurementPublicSample,
        userNameById,
      });
      return {
        targetId: Number(target.id),
        code: target.code,
        businessName: target.business_name,
        address: target.address,
        year: Number(target.year),
        period: target.period,
        kind,
        measurementDate: target.measurement_date,
        preliminaryDate: plan?.recommended_date ?? null,
        surveyors: Array.isArray(plan?.participant_names) ? plan.participant_names : [],
        surveyMethod: plan?.survey_method ?? (kind === "기존업체" ? "phone" : "field"),
        mainMeasurer: measurementAssigneeDisplay.label,
        mainMeasurerSource: measurementAssigneeDisplay.source,
        measurementParticipants: staff.measurementParticipants,
        reportWriter: userNameById.get(Number(target.measurer_id)) ?? "-",
        status: presentationState.status,
        conflict: presentationState.conflict,
        reason: plan?.recommendation_reason?.reason ?? null,
        recommendationReasons: Array.isArray(plan?.recommendation_reason?.shortReasons)
          ? plan.recommendation_reason.shortReasons : [],
        planOrigin: plan?.plan_origin ?? null,
        locked: trueConfirmed,
      };
    });
    return NextResponse.json({ rows, users: users ?? [], year, period });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKBENCH_QUERY_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSurveyAccess();
    const body = await request.json();
    const supabase = await createClient();
    if (!await canManagePreliminarySurvey(supabase, session)) {
      return NextResponse.json({ error: "예비조사 담당자 또는 관리자만 추천안을 생성·적용할 수 있습니다." }, { status: 403 });
    }
    if (body.action === "apply") {
      return applySubmittedDrafts(
        supabase,
        Array.isArray(body.drafts) ? body.drafts : [],
        body.approveThirdAssignment === true,
        session.userId,
      );
    }
    if (body.action !== "recommend") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }
    if (!Array.isArray(body.targetIds) || body.targetIds.length === 0) {
      return NextResponse.json({ error: "추천할 사업장을 선택해 주세요." }, { status: 400 });
    }
    const requestedTargetIds = body.targetIds.map(Number);
    if (requestedTargetIds.some((value: number) => !Number.isInteger(value) || value <= 0) ||
        new Set(requestedTargetIds).size !== requestedTargetIds.length) {
      return NextResponse.json({ error: "추천 대상 사업장 정보가 올바르지 않습니다." }, { status: 400 });
    }
    let targetIds = requestedTargetIds;
    let impactTargets: PreliminarySurveyImpactTarget[] | null = null;
    const explicitTargetSelection = body.explicitTargetSelection === true;
    const measurementDateFrom = body.measurementDateFrom == null || body.measurementDateFrom === ""
      ? undefined : String(body.measurementDateFrom);
    const measurementDateTo = body.measurementDateTo == null || body.measurementDateTo === ""
      ? undefined : String(body.measurementDateTo);
    if ((measurementDateFrom && !parseDateOnly(measurementDateFrom)) ||
        (measurementDateTo && !parseDateOnly(measurementDateTo)) ||
        (measurementDateFrom && measurementDateTo && measurementDateFrom > measurementDateTo)) {
      return NextResponse.json({ error: "측정예정일 기간이 올바르지 않습니다." }, { status: 400 });
    }
    const preliminaryDateFrom = body.preliminaryDateFrom == null || body.preliminaryDateFrom === ""
      ? undefined : String(body.preliminaryDateFrom);
    const preliminaryDateTo = body.preliminaryDateTo == null || body.preliminaryDateTo === ""
      ? undefined : String(body.preliminaryDateTo);
    if ((preliminaryDateFrom && !parseDateOnly(preliminaryDateFrom)) ||
        (preliminaryDateTo && !parseDateOnly(preliminaryDateTo)) ||
        (preliminaryDateFrom && preliminaryDateTo && preliminaryDateFrom > preliminaryDateTo)) {
      return NextResponse.json({ error: "예비조사 기간이 올바르지 않습니다." }, { status: 400 });
    }
    let impactScope: PreliminarySurveyImpactScope | null = null;
    let lockedScheduleConflictTargetIds: number[] = [];
    // 업체별 재추천은 저장된 현재 관계의 dependency closure 전체를 재검증한다.
    if (requestedTargetIds.length === 1) {
      const targetId = requestedTargetIds[0];
      const { data: seedTarget, error: seedError } = await supabase.from("measurement_target_business")
        .select("id, year, period").eq("id", targetId).maybeSingle();
      if (seedError) throw seedError;
      if (!seedTarget) return NextResponse.json({ error: "추천 대상 사업장을 찾을 수 없습니다." }, { status: 404 });
      const { data: relationTargets, error: relationTargetError } = await supabase.from("measurement_target_business")
        .select("id, code, year, period, measurement_date, measurement_end_date, daily_staff, measurer_id, collaborators, address")
        .eq("year", seedTarget.year).eq("period", seedTarget.period);
      if (relationTargetError) throw relationTargetError;
      const relationIds = (relationTargets ?? []).map((target: any) => Number(target.id));
      const relationCodes = [...new Set((relationTargets ?? []).map((target: any) => target.code))];
      const [
        { data: relationPlans, error: relationPlanError },
        { data: relationJournals, error: relationJournalError },
        { data: relationUsers, error: relationUserError },
      ] = await Promise.all([
        relationIds.length ? supabase.from("preliminary_survey_v2_plans")
          .select("id, measurement_target_business_id, recommended_date, participant_user_ids, survey_method, route_evidence, recommendation_reason")
          .in("measurement_target_business_id", relationIds) : Promise.resolve({ data: [], error: null }),
        relationCodes.length ? supabase.from("measurement_journal")
          .select("code, measurement_year, measurement_period").in("code", relationCodes) : Promise.resolve({ data: [], error: null }),
        supabase.from("users").select("id, name").eq("job", "측정"),
      ]);
      if (relationPlanError || relationJournalError || relationUserError) {
        throw relationPlanError || relationJournalError || relationUserError;
      }
      const planIds = (relationPlans ?? []).map((plan: any) => String(plan.id));
      const { data: relationAssignments, error: relationAssignmentError } = planIds.length
        ? await supabase.from("preliminary_survey_v2_measurement_assignments")
          .select("plan_id, measurement_date, assignee_user_id").in("plan_id", planIds)
        : { data: [], error: null };
      if (relationAssignmentError && !isMeasurementAssignmentSchemaMissing(relationAssignmentError)) throw relationAssignmentError;
      const planByTarget = new Map((relationPlans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
      const assignmentsByPlan = new Map<string, any[]>();
      for (const assignment of relationAssignments ?? []) {
        assignmentsByPlan.set(String(assignment.plan_id), [
          ...(assignmentsByPlan.get(String(assignment.plan_id)) ?? []), assignment,
        ]);
      }
      const relationUserIdByName = new Map((relationUsers ?? [])
        .map((user: any) => [String(user.name ?? "").trim(), Number(user.id)]));
      const relationScheduleDates = [
        ...(relationPlans ?? []).map((plan: any) => String(plan.recommended_date ?? "")),
        ...(relationAssignments ?? []).map((assignment: any) => String(assignment.measurement_date ?? "")),
        ...(relationTargets ?? []).flatMap((target: any) => explicitMeasurementDates(target)),
      ].filter((date) => parseDateOnly(date));
      const relationScheduleUserIds = [
        ...(relationPlans ?? []).flatMap((plan: any) => roleIdsForPlan(plan)),
        ...(relationAssignments ?? []).map((assignment: any) => Number(assignment.assignee_user_id)),
        ...(relationTargets ?? []).flatMap((target: any) => measurementRoleKeys(target, relationUserIdByName)
          .map((key) => Number(key.split(":", 1)[0]))),
      ];
      const relationScheduleBlockedKeys = await loadScheduleBlockKeys(
        supabase,
        relationScheduleDates,
        relationScheduleUserIds,
      );
      const confirmed = new Set((relationJournals ?? []).map((journal: any) =>
        journalKey(journal.code, journal.measurement_year, journal.measurement_period)));
      impactTargets = (relationTargets ?? []).map((target: any) => {
        const plan: any = planByTarget.get(Number(target.id));
        const planAssignments = assignmentsByPlan.get(String(plan?.id)) ?? [];
        const persistedDates = planAssignments
          .map((assignment) => String(assignment.measurement_date));
        const preliminaryScheduleBlocked = Boolean(plan?.recommended_date) && roleIdsForPlan(plan)
          .some((userId) => relationScheduleBlockedKeys.has(`${userId}:${plan.recommended_date}`));
        const measurementScheduleBlocked = planAssignments.some((assignment) =>
          relationScheduleBlockedKeys.has(`${Number(assignment.assignee_user_id)}:${String(assignment.measurement_date)}`),
        );
        const measurementRoleScheduleBlocked = measurementRoleKeys(target, relationUserIdByName)
          .some((key) => relationScheduleBlockedKeys.has(key));
        return {
          targetId: Number(target.id),
          preliminaryDate: plan?.recommended_date ?? null,
          participantUserIds: Array.isArray(plan?.participant_user_ids) ? plan.participant_user_ids.map(Number) : [],
          responsibleUserId: Number(plan?.responsible_user_id) || null,
          experiencedReviewerUserId: Number(plan?.experienced_reviewer_id) || null,
          surveyMethod: plan?.survey_method === "field" ? "field" : plan?.survey_method === "phone" ? "phone" : null,
          address: target.address ?? null,
          visitBundleKey: plan?.route_evidence?.visitBundleKey ?? null,
          measurementDate: target.measurement_date ?? null,
          measurementDates: persistedDates.length ? persistedDates : explicitMeasurementDates(target),
          measurementAssigneeUserId: Number((assignmentsByPlan.get(String(plan?.id)) ?? [])[0]?.assignee_user_id) ||
            (Number.isInteger(Number(plan?.recommendation_reason?.measurementAssignee?.userId))
              ? Number(plan.recommendation_reason.measurementAssignee.userId) : null),
          locked: confirmed.has(journalKey(target.code, target.year, target.period)),
          scheduleBlocked: preliminaryScheduleBlocked || measurementScheduleBlocked || measurementRoleScheduleBlocked,
        } satisfies PreliminarySurveyImpactTarget;
      });
      impactScope = calculatePreliminarySurveyImpactScope({
        seedTargetIds: [targetId],
        targets: impactTargets,
      });
      lockedScheduleConflictTargetIds = impactTargets
        .filter((target) => target.locked && target.scheduleBlocked)
        .map((target) => target.targetId).sort((left, right) => left - right);
      targetIds = impactScope.targetIds;
    }
    let candidateQuery = supabase.from("measurement_target_business").select("id, code, year, period, measurement_date");
    candidateQuery = candidateQuery.in("id", targetIds);
    if (requestedTargetIds.length !== 1 && measurementDateFrom) candidateQuery = candidateQuery.gte("measurement_date", measurementDateFrom);
    if (requestedTargetIds.length !== 1 && measurementDateTo) candidateQuery = candidateQuery.lte("measurement_date", measurementDateTo);
    const { data: candidateRows, error: candidateError } = await candidateQuery;
    if (candidateError) throw candidateError;
    const candidateCodes = [...new Set((candidateRows ?? []).map((row: any) => row.code))];
    const candidateIds = (candidateRows ?? []).map((row: any) => Number(row.id));
    const [{ data: journalRows, error: journalError }, { data: planRows, error: planError }] = await Promise.all([
      candidateCodes.length
        ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", candidateCodes)
        : Promise.resolve({ data: [], error: null }),
      !explicitTargetSelection && candidateIds.length
        ? supabase.from("preliminary_survey_v2_plans").select("measurement_target_business_id, plan_origin, source_measurement_date").in("measurement_target_business_id", candidateIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (journalError || planError) throw journalError || planError;
    const confirmedKeys = new Set((journalRows ?? []).map((row: any) => journalKey(row.code, row.measurement_year, row.measurement_period)));
    const selectedTargetIds = new Set(targetIds);
    const planByTarget = new Map((planRows ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    let eligibleTargetIds = (candidateRows ?? []).filter((row: any) => {
      if (!selectedTargetIds.has(Number(row.id))) return false;
      if (confirmedKeys.has(journalKey(row.code, row.year, row.period))) return false;
      if (explicitTargetSelection) return true;
      const plan: any = planByTarget.get(Number(row.id));
      return !plan || plan.plan_origin !== "manual" || plan.source_measurement_date !== row.measurement_date;
    }).map((row: any) => Number(row.id));
    if (!eligibleTargetIds.length) {
      return NextResponse.json({
        success: true, drafts: [], missing: [], scope: requestedTargetIds.length === 1 ? "target_business" : "range",
        impactSummary: "변경 가능한 대상이 없습니다.",
        impactTargetIds: impactScope?.targetIds ?? requestedTargetIds,
        lockedTargetIds: impactScope?.lockedTargetIds ?? [],
        lockedScheduleConflictTargetIds,
        impactReasonsByTarget: impactScope?.reasonsByTarget ?? null,
      });
    }
    let output = await calculateV2Recommendations(supabase, {
      targetIds: eligibleTargetIds,
      measurementDateFrom: requestedTargetIds.length === 1 ? undefined : measurementDateFrom,
      measurementDateTo: requestedTargetIds.length === 1 ? undefined : measurementDateTo,
      preliminaryDateFrom,
      preliminaryDateTo,
    });
    if (impactScope && impactTargets) {
      // 새 제안 날짜·조합이 만드는 관계도 closure에 포함될 때까지 범위를 확장한다.
      for (let attempt = 0; attempt < impactTargets.length; attempt += 1) {
        const resultByTarget = new Map(output.results.map((result) => [result.targetId, result]));
        const proposedTargets = impactTargets.map((target) => {
          const result = resultByTarget.get(target.targetId);
          return result ? {
            ...target,
            preliminaryDate: result.date,
            participantUserIds: result.participants.map((user) => user.id),
            responsibleUserId: result.responsible.id,
            experiencedReviewerUserId: result.experiencedReviewer?.id ?? null,
            surveyMethod: result.surveyMethod,
          } : target;
        });
        const expanded = calculatePreliminarySurveyImpactScope({
          seedTargetIds: requestedTargetIds,
          targets: proposedTargets,
        });
        if (expanded.targetIds.every((targetId) => impactScope!.targetIds.includes(targetId))) {
          impactScope = expanded;
          break;
        }
        impactScope = expanded;
        targetIds = expanded.targetIds;
        eligibleTargetIds = expanded.targetIds.filter((targetId) => !expanded.lockedTargetIds.includes(targetId));
        if (!eligibleTargetIds.length) break;
        output = await calculateV2Recommendations(supabase, {
          targetIds: eligibleTargetIds,
          preliminaryDateFrom,
          preliminaryDateTo,
        });
      }
    }

    // 측정자(공시료 담당자)는 활성 users.survey_code와 plan 귀속 날짜별 원천만 사용한다.
    const [
      { data: assigneeUsers, error: assigneeUserError },
      { data: measurementRoleUsers, error: measurementRoleUserError },
      { data: persistedAssignments, error: persistedAssignmentError },
      { data: persistedPlans, error: persistedPlanError },
    ] = await Promise.all([
      supabase.from("users").select("id, name, is_active, survey_code").eq("is_active", true).not("survey_code", "is", null),
      supabase.from("users").select("id, name").eq("job", "측정"),
      supabase.from("preliminary_survey_v2_measurement_assignments").select("plan_id, measurement_date, assignee_user_id"),
      supabase.from("preliminary_survey_v2_plans").select("id, measurement_target_business_id"),
    ]);
    if (assigneeUserError || measurementRoleUserError || persistedPlanError ||
        (persistedAssignmentError && !isMeasurementAssignmentSchemaMissing(persistedAssignmentError))) {
      throw assigneeUserError || measurementRoleUserError || persistedPlanError || persistedAssignmentError;
    }
    const measurementRoleUserIdByName = new Map((measurementRoleUsers ?? [])
      .map((user: any) => [String(user.name ?? "").trim(), Number(user.id)]));
    const measurementRoleKeysByTarget = new Map(output.targets.map((target) => [target.id, measurementRoleKeys({
      daily_staff: target.sourceDailyStaffSnapshot,
      measurement_date: target.measurementDate,
      measurer_id: target.sourceMeasurerId,
      collaborators: target.sourceCollaboratorsSnapshot,
    }, measurementRoleUserIdByName)]));
    const measurementRoleKeysAll = [...measurementRoleKeysByTarget.values()].flat();
    const measurementRoleBlockedKeys = await loadScheduleBlockKeys(
      supabase,
      measurementRoleKeysAll.map((key) => key.slice(key.indexOf(":") + 1)),
      measurementRoleKeysAll.map((key) => Number(key.slice(0, key.indexOf(":")))),
    );
    const measurementRoleConflictTargetIds = new Set([...measurementRoleKeysByTarget.entries()]
      .filter(([, keys]) => keys.some((key) => measurementRoleBlockedKeys.has(key)))
      .map(([targetId]) => targetId));
    // migration 전 POST 추천은 draft 생성만 허용하며, apply는 위의 schema 409 경계에서 차단한다.
    const assignmentRowsForRecommendation = persistedAssignmentError ? [] : (persistedAssignments ?? []);
    const persistedPlanById = new Map((persistedPlans ?? []).map((plan: any) => [String(plan.id), plan]));
    const existingBusinessIds = [...new Set((persistedPlans ?? [])
      .map((plan: any) => Number(plan.measurement_target_business_id))
      .filter((id: number) => !eligibleTargetIds.includes(id)))];
    const { data: existingTargetRows, error: existingTargetError } = existingBusinessIds.length
      ? await supabase.from("measurement_target_business").select("id, code, address").in("id", existingBusinessIds)
      : { data: [], error: null };
    if (existingTargetError) throw existingTargetError;
    const existingCodes = [...new Set((existingTargetRows ?? []).map((target: any) => target.code).filter(Boolean))];
    const { data: existingInfoRows, error: existingInfoError } = existingCodes.length
      ? await supabase.from("business_info").select("code, latitude, longitude").in("code", existingCodes)
      : { data: [], error: null };
    if (existingInfoError) throw existingInfoError;
    const existingTargetById = new Map((existingTargetRows ?? []).map((target: any) => [Number(target.id), target]));
    const existingInfoByCode = new Map((existingInfoRows ?? []).map((info: any) => [info.code, info]));
    const existingMeasurementAssignments = assignmentRowsForRecommendation.flatMap((assignment: any) => {
      const plan: any = persistedPlanById.get(String(assignment.plan_id));
      const business: any = existingTargetById.get(Number(plan?.measurement_target_business_id));
      const info: any = existingInfoByCode.get(business?.code);
      if (!plan || !business) return [];
      return [{
        targetId: Number(plan.measurement_target_business_id), measurementDate: String(assignment.measurement_date),
        address: business.address ?? null,
        businessCode: business.code,
        region: routeRegion(business.address),
        coordinate: Number.isFinite(Number(info?.latitude)) && Number.isFinite(Number(info?.longitude))
          ? { latitude: Number(info.latitude), longitude: Number(info.longitude) } : null,
        userId: Number(assignment.assignee_user_id),
      }];
    });
    const measurementAssignmentTargets = output.results.filter((result) => result.status === "recommended").flatMap((result) => {
      const target = output.targets.find((item) => item.id === result.targetId)!;
      return buildMeasurementAssignmentTargets({
        target,
        preliminarySurveyorUserId: result.responsible.id,
      });
    });
    const assigneeBlockKeys = await loadScheduleBlockKeys(
      supabase,
      measurementAssignmentTargets.map((target) => target.measurementDate),
      (assigneeUsers ?? []).map((user: any) => Number(user.id)),
    );
    const assigneeCapacity = (assigneeUsers ?? []).filter((user: any) => isSurveyCode(String(user.survey_code ?? "").trim().toUpperCase())).length;
    const routeNeededDates = new Set(assigneeCapacity > 0 ? [...new Set(measurementAssignmentTargets.map((target) => target.measurementDate))].filter((date) =>
      measurementAssignmentTargets.filter((target) => target.measurementDate === date).length +
        existingMeasurementAssignments.filter((target) => target.measurementDate === date).length > assigneeCapacity,
    ) : []);
    const measurementRouteEvidence = await collectMeasurementVehicleRouteEvidence({
      targets: measurementAssignmentTargets.filter((target) => routeNeededDates.has(target.measurementDate)),
      existing: existingMeasurementAssignments.filter((target) => routeNeededDates.has(target.measurementDate)),
      routes: createRouteMetrics(),
    });
    const measurementAssignments = assignMeasurementAssignees({
      targets: measurementAssignmentTargets,
      users: (assigneeUsers ?? []).map((user: any) => ({
        id: Number(user.id), name: user.name, active: user.is_active, surveyCode: user.survey_code,
      })),
      existing: existingMeasurementAssignments,
      routeEvidence: measurementRouteEvidence,
      availability: { isBlocked: (userId, date) => assigneeBlockKeys.has(`${userId}:${date}`) },
    });
    const measurementAssignmentByTarget = new Map<number, typeof measurementAssignments>();
    for (const assignment of measurementAssignments) {
      measurementAssignmentByTarget.set(assignment.targetId, [
        ...(measurementAssignmentByTarget.get(assignment.targetId) ?? []), assignment,
      ]);
    }

    const recommendationScope: RecommendationScopeSnapshot = {
      measurementDateFrom: requestedTargetIds.length === 1 ? null : measurementDateFrom ?? null,
      measurementDateTo: requestedTargetIds.length === 1 ? null : measurementDateTo ?? null,
      preliminaryDateFrom: preliminaryDateFrom ?? null,
      preliminaryDateTo: preliminaryDateTo ?? null,
    };
    const applyableTargetIds = new Set(output.results.flatMap((result) => {
      const target = output.targets.find((item) => item.id === result.targetId)!;
      const assignments = measurementAssignmentByTarget.get(result.targetId) ?? [];
      return result.status === "recommended" && Boolean(target.measurementAssignmentDates?.length) &&
        assignments.length === target.measurementAssignmentDates!.length &&
        !measurementRoleConflictTargetIds.has(result.targetId) ? [result.targetId] : [];
    }));
    const canonicalPreview = canonicalizeWorkbenchDraft({
      scope: recommendationScope,
      surveys: canonicalSurveySnapshot(output).filter((survey) => applyableTargetIds.has(survey.targetId)),
      measurementAssignments: measurementAssignments.filter((assignment) => applyableTargetIds.has(assignment.targetId)).map((assignment) => ({
        targetId: assignment.targetId,
        measurementDate: assignment.measurementDate,
        userId: assignment.userId,
        userName: assignment.userName,
        surveyCode: assignment.publicSampleCode,
        approvalRequired: assignment.approvalRequired,
        reason: assignment.reason,
      })),
    });
    const fingerprint = canonicalFingerprint(canonicalPreview);
    const drafts = output.results.map((result) => {
        const target = output.targets.find((item) => item.id === result.targetId)!;
        const targetAssignments = measurementAssignmentByTarget.get(result.targetId) ?? [];
        const assignmentIncomplete = !target.measurementAssignmentDates?.length ||
          targetAssignments.length !== target.measurementAssignmentDates.length;
        const measurementRoleConflict = measurementRoleConflictTargetIds.has(result.targetId);
        const recommendationReasons = [
          `${target.businessType === "external_new" ? "타기관 신규" : target.businessType === "first_measurement" ? "최초실시" : "기존업체"} · ${result.surveyMethod === "field" ? "방문" : "유선"}`,
          ...targetAssignments.map((assignment) => assignment.reason),
        ].filter(Boolean);
        return {
          targetId: result.targetId,
          code: target.code,
          businessName: target.name,
          kind: target.businessType === "external_new" ? "타기관 신규" : target.businessType === "first_measurement" ? "최초실시" : "기존업체",
          measurementDate: target.measurementDate,
          preliminaryDate: result.date,
          participantUserIds: result.participants.map((user) => user.id),
          surveyors: result.participants.map((user) => user.name),
          surveyMethod: result.surveyMethod,
          sourceMeasurementDate: target.measurementDate,
          sourceMeasurerId: target.sourceMeasurerId ?? null,
          sourceResponsibleUserId: result.responsible.id,
          sourceRuleType: target.kind,
          sourceAddress: target.address,
          sourceMeasurementParticipants: target.measurementParticipantsSnapshot ?? "-",
          sourcePlanFingerprint: sourcePlanFingerprint(target),
          measurementAssigneeUserId: targetAssignments[0]?.userId,
          measurementAssigneeName: targetAssignments[0]?.userName,
          publicSampleCode: targetAssignments[0]?.publicSampleCode,
          measurementAssignmentApprovalRequired: targetAssignments.some((assignment) => assignment.approvalRequired),
          recommendationScope,
          measurementAssignments: targetAssignments.map((assignment) => ({
            targetId: assignment.targetId,
            measurementDate: assignment.measurementDate,
            userId: assignment.userId,
            userName: assignment.userName,
            surveyCode: assignment.publicSampleCode,
            approvalRequired: assignment.approvalRequired,
            reason: assignment.reason,
          })),
          recommendationReasons,
          mainMeasurer: targetAssignments.length
            ? [...new Set(targetAssignments.map((assignment) =>
                measurementAssigneeLabel(assignment.userName, assignment.publicSampleCode),
              ))].join(", ") : "-",
          status: result.status === "recommended" && !assignmentIncomplete && !measurementRoleConflict
            ? "recommended" : "adjustment_required",
          conflict: result.status === "manual_required"
            ? result.reason
            : measurementRoleConflict ? "측정일의 보고서 담당자 또는 측정 참여자 불가 일정 충돌"
            : assignmentIncomplete ? "다일 측정 날짜별 인력 정보 또는 측정자 배정 필요"
              : result.evidence.warnings.includes("EXPERIENCED_REVIEWER_UNASSIGNED") ? "경력 검토자 미배정"
              : targetAssignments.some((assignment) => assignment.approvalRequired) ? "3건 승인 필요" : null,
          reason: result.reason,
          alternatives: recommendationDatesForBusinessType(
            target.measurementDate,
            target.businessType ?? (target.kind === "existing" ? "existing" : "first_measurement"),
          ).map((item) => item.date).filter((date) =>
            (!preliminaryDateFrom || date >= preliminaryDateFrom) &&
            (!preliminaryDateTo || date <= preliminaryDateTo) &&
            date !== result.date,
          ).slice(0, 3),
        };
      });
    return NextResponse.json({
      success: true,
      drafts: drafts.map((draft) => ({ ...draft, canonicalFingerprint: fingerprint })),
      missing: output.missing,
      scope: requestedTargetIds.length === 1 ? "target_business" : "range",
      impactSummary: requestedTargetIds.length === 1
        ? `${targetIds.length}개 영향 범위(같은 예비조사일·조사자·주소·측정일)를 재검증했습니다.`
        : null,
      impactTargetIds: impactScope?.targetIds ?? requestedTargetIds,
      lockedTargetIds: impactScope?.lockedTargetIds ?? [],
      lockedScheduleConflictTargetIds,
      impactReasonsByTarget: impactScope?.reasonsByTarget ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKBENCH_RECOMMEND_FAILED";
    if (error instanceof MeasurementAssignmentDailyLimitError) {
      return NextResponse.json({
        error: "측정자 1인당 같은 측정일에는 최대 3건까지만 배정할 수 있습니다.",
        code: error.code,
        targetId: error.targetId,
        measurementDate: error.measurementDate,
      }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
