import { buildScheduleBlockKeys } from "./availability";
import { parseDateOnly } from "./calendar";
import {
  assignMeasurementAssignees,
  buildMeasurementAssignmentTargets,
  collectMeasurementVehicleRouteEvidence,
  type ExistingMeasurementAssignment,
  type MeasurementAssignmentTarget,
  type SurveyCode,
} from "./measurement-assignment";
import { createRouteMetrics } from "./route-metrics";
import type { SurveyTarget } from "./types";
import { operationalMeasurementUsers } from "../business/operational-measurement-user";

export interface CanonicalMeasurementAssignment {
  targetId: number;
  measurementDate: string;
  userId: number;
  userName: string;
  surveyCode: SurveyCode;
  approvalRequired: boolean;
  reason: string;
}

interface MeasurementAssignmentContext {
  target: SurveyTarget;
}

function isBaseSurveyCode(value: unknown) {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F" || value === "G";
}

function routeRegion(address: unknown) {
  const parts = String(address ?? "").trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] || null;
}

async function loadScheduleBlockKeys(
  supabase: any,
  datesInput: readonly string[],
  userIdsInput: readonly number[],
) {
  const dates = [...new Set(datesInput.filter((date) => parseDateOnly(date)))].sort();
  const userIds = [...new Set(userIdsInput.filter((id) => Number.isInteger(id) && id > 0))];
  if (!dates.length || !userIds.length) return new Set<string>();
  const { data, error } = await supabase.from("user_schedule_blocks")
    .select("user_id, start_date, end_date")
    .lte("start_date", dates.at(-1))
    .gte("end_date", dates[0])
    .in("user_id", userIds);
  if (error) throw error;
  return buildScheduleBlockKeys(data ?? []);
}

export function isMeasurementAssignmentSchemaMissing(error: any) {
  return ["42P01", "PGRST202", "PGRST205"].includes(String(error?.code ?? "")) ||
    /preliminary_survey_v2_measurement_assignments|persist_preliminary_survey_v2_plan_and_assignment_groups/i
      .test(String(error?.message ?? ""));
}

/**
 * 자동 추천 Apply와 수동 수정이 동일한 users.survey_code·용량·동선·baseline을 사용해
 * 날짜별 측정자(공시료)를 서버에서 재계산한다. client의 assignee/code는 저장 근거가 아니다.
 */
export async function recomputeCanonicalMeasurementAssignments(
  supabase: any,
  contexts: MeasurementAssignmentContext[],
  preliminarySurveyorUserIdsByTarget: ReadonlyMap<number, readonly number[]>,
  allowAdminThirdAssignment: boolean,
) {
  const [{ data: assigneeUsers, error: assigneeUserError }, { data: persisted, error: persistedError }] = await Promise.all([
    supabase.from("users").select("id, name, job, is_active, survey_code").eq("is_active", true).not("survey_code", "is", null),
    supabase.from("preliminary_survey_v2_measurement_assignments").select(
      "plan_id, measurement_date, assignee_user_id, approval_required, approval_group_fingerprint",
    ),
  ]);
  if (persistedError && isMeasurementAssignmentSchemaMissing(persistedError)) return { schemaMissing: true as const };
  if (assigneeUserError || persistedError) throw assigneeUserError || persistedError;
  const operationalAssigneeUsers = operationalMeasurementUsers(assigneeUsers);

  const persistedPlanIds = [...new Set((persisted ?? []).map((item: any) => String(item.plan_id)))];
  const { data: persistedPlans, error: persistedPlanError } = persistedPlanIds.length
    ? await supabase.from("preliminary_survey_v2_plans").select("id, measurement_target_business_id").in("id", persistedPlanIds)
    : { data: [], error: null };
  if (persistedPlanError) throw persistedPlanError;
  const submittedIds = new Set(contexts.map((context) => context.target.id));
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
  const assignmentTargets: MeasurementAssignmentTarget[] = contexts.flatMap((context) =>
    buildMeasurementAssignmentTargets({
      target: context.target,
      preliminarySurveyorUserIds: [...(preliminarySurveyorUserIdsByTarget.get(context.target.id) ?? [])],
    }));
  const assigneeBlockKeys = await loadScheduleBlockKeys(
    supabase,
    assignmentTargets.map((target) => target.measurementDate),
    operationalAssigneeUsers.map((user: any) => Number(user.id)),
  );
  const assigneeCapacity = operationalAssigneeUsers
    .filter((user: any) => isBaseSurveyCode(String(user.survey_code ?? "").trim().toUpperCase())).length;
  const routeNeededDates = new Set(assigneeCapacity > 0
    ? [...new Set(assignmentTargets.map((target) => target.measurementDate))].filter((date) =>
      assignmentTargets.filter((target) => target.measurementDate === date).length +
        existing.filter((target) => target.measurementDate === date).length > assigneeCapacity)
    : []);
  const routeEvidence = await collectMeasurementVehicleRouteEvidence({
    targets: assignmentTargets.filter((target) => routeNeededDates.has(target.measurementDate)),
    existing: existing.filter((target) => routeNeededDates.has(target.measurementDate)),
    routes: createRouteMetrics(),
  });
  const assignments = assignMeasurementAssignees({
    targets: assignmentTargets,
    users: operationalAssigneeUsers.map((user: any) => ({
      id: Number(user.id), name: user.name, active: user.is_active, surveyCode: user.survey_code,
    })),
    existing,
    routeEvidence,
    availability: { isBlocked: (userId, date) => assigneeBlockKeys.has(`${userId}:${date}`) },
    allowAdminThirdAssignment,
  });
  const proposedMeasurementDates = new Set(assignmentTargets.map((target) => target.measurementDate));
  const baseline = existing.filter((assignment) => proposedMeasurementDates.has(assignment.measurementDate)).map((assignment) => ({
    targetId: assignment.targetId,
    measurementDate: assignment.measurementDate,
    userId: assignment.userId,
  })).sort((left, right) => left.targetId - right.targetId ||
    left.measurementDate.localeCompare(right.measurementDate) || left.userId - right.userId);
  const userById = new Map(operationalAssigneeUsers.map((user: any) => [Number(user.id), user]));
  const invalidSurveyCodeUserIds: number[] = [];
  const canonical = assignments.flatMap((assignment) => {
    const user: any = userById.get(assignment.userId);
    const surveyCode = String(user?.survey_code ?? "").trim().toUpperCase();
    if (!isBaseSurveyCode(surveyCode)) {
      invalidSurveyCodeUserIds.push(assignment.userId);
      return [];
    }
    return [{
      targetId: assignment.targetId,
      measurementDate: assignment.measurementDate,
      userId: assignment.userId,
      userName: assignment.userName,
      surveyCode: assignment.publicSampleCode,
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
    expectedAssignmentCount: assignmentTargets.length,
  };
}
