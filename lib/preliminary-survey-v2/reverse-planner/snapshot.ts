import { measurementDayFormsFrom } from "@/lib/business/measurement-day-form";
import {
  PRELIMINARY_SURVEY_CANONICAL_SHA,
  REVERSE_PLANNER_VERSION,
  type PlanningSnapshot,
} from "./types";

const integers = (value: unknown) => Array.isArray(value)
  ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0)
  : [];

function businessType(value: unknown, legacyRule: unknown) {
  const normalized = String(value ?? "");
  if (normalized === "first_measurement" || String(legacyRule) === "general_new") return "first_measurement" as const;
  if (normalized === "external_new" || String(legacyRule) === "other_org_new") return "external_new" as const;
  return "existing" as const;
}

export function buildPlanningSnapshot(input: {
  targets: any[];
  users: any[];
  fixedAssignments: any[];
  plans: any[];
  assignments: any[];
  scheduleBlocks: any[];
  routeEvidence?: PlanningSnapshot["routeEvidence"];
  trueConfirmedTargetIds?: number[];
  planningTargetIds?: number[];
}): PlanningSnapshot {
  const users = input.users.map((user) => ({
    id: Number(user.id),
    name: String(user.name),
    active: user.is_active !== false,
    experienced: user.is_preliminary_survey_experienced === true,
    baseCode: user.survey_code == null ? null : String(user.survey_code).trim().toUpperCase(),
  }));
  const userIdByName = new Map(users.map((user) => [user.name.trim(), user.id]));
  const planByTarget = new Map(input.plans.map((plan) => [Number(plan.measurement_target_business_id), plan]));
  const assignmentsByPlan = new Map<string, any[]>();
  for (const assignment of input.assignments) {
    const id = String(assignment.plan_id);
    assignmentsByPlan.set(id, [...(assignmentsByPlan.get(id) ?? []), assignment]);
  }
  const fixedByTarget = new Map<number, any[]>();
  for (const fixed of input.fixedAssignments) {
    const id = Number(fixed.measurement_target_business_id);
    fixedByTarget.set(id, [...(fixedByTarget.get(id) ?? []), fixed]);
  }
  const protectedIds = new Set(input.trueConfirmedTargetIds ?? []);
  const allTargets = input.targets.map((target) => {
    const days = measurementDayFormsFrom({
      dailyStaff: target.daily_staff,
      measurementDate: target.measurement_date,
      measurerId: target.measurer_id,
      collaborators: target.collaborators,
    }).map((day) => {
      const invalidCollaboratorNames = day.collaborators
        .filter((name) => !userIdByName.has(name));
      const reportWriterUserId = day.measurerId == null ? null : Number(day.measurerId);
      return {
        date: day.date,
        collaboratorUserIds: day.collaborators
          .map((name) => userIdByName.get(name))
          .filter((id): id is number => id != null),
        reportWriterUserId,
        invalidCollaboratorNames,
        invalidReportWriterUserId: reportWriterUserId != null && !users.some((user) => user.id === reportWriterUserId)
          ? reportWriterUserId : null,
      };
    }).sort((left, right) => left.date.localeCompare(right.date));
    const plan = planByTarget.get(Number(target.id));
    return {
      id: Number(target.id),
      code: String(target.code),
      name: String(target.business_name),
      address: target.address == null ? null : String(target.address),
      businessType: businessType(target.business_type, target.preliminary_survey_rule_type),
      days,
      sourceMeasurementDate: String(target.measurement_date),
      sourceReportWriterUserId: target.measurer_id == null ? null : Number(target.measurer_id),
      sourceCollaborators: target.collaborators ?? null,
      sourceDailyStaff: target.daily_staff ?? null,
      fixedAssignments: (fixedByTarget.get(Number(target.id)) ?? []).map((fixed) => ({
        targetId: Number(target.id),
        measurementDate: String(fixed.measurement_date),
        assigneeUserId: Number(fixed.assignee_user_id),
        confirmedAt: String(fixed.confirmed_at),
        updatedAt: String(fixed.updated_at),
        nonParticipantConfirmed: fixed.source_snapshot?.nonParticipantConfirmed === true,
      })).sort((left, right) => left.measurementDate.localeCompare(right.measurementDate)),
      existingPlan: plan ? {
        id: String(plan.id),
        preliminaryDate: plan.recommended_date == null ? null : String(plan.recommended_date),
        surveyMethod: plan.survey_method === "field" ? "field" as const : "phone" as const,
        participantUserIds: integers(plan.participant_user_ids),
        responsibleUserId: Number(plan.responsible_user_id),
        reviewerUserId: plan.experienced_reviewer_id == null ? null : Number(plan.experienced_reviewer_id),
        protected: protectedIds.has(Number(target.id)),
        updatedAt: String(plan.updated_at),
        assignments: (assignmentsByPlan.get(String(plan.id)) ?? []).map((assignment) => ({
          measurementDate: String(assignment.measurement_date),
          assigneeUserId: Number(assignment.assignee_user_id),
          surveyCode: String(assignment.survey_code),
          publicSampleCode: assignment.public_sample_code == null ? null : String(assignment.public_sample_code),
        })).sort((left, right) => left.measurementDate.localeCompare(right.measurementDate)),
      } : null,
    };
  });
  const planningIds = new Set(input.planningTargetIds ?? allTargets.map((target) => target.id));
  const targets = allTargets.filter((target) => planningIds.has(target.id));
  const targetById = new Map(allTargets.map((target) => [target.id, target]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const existingSurveyOccupancy = input.plans.flatMap((plan) => {
    const target = targetById.get(Number(plan.measurement_target_business_id));
    const preliminaryDate = plan.recommended_date == null ? "" : String(plan.recommended_date);
    if (!target || !preliminaryDate) return [];
    const participantUserIds = integers(plan.participant_user_ids);
    const participants = participantUserIds.map((id) => userById.get(id)).filter(Boolean);
    const writer = participants.find((user) => user?.experienced === false)
      ?? participants.find((user) => user?.experienced === true)
      ?? null;
    return [{
      targetId: target.id,
      businessCode: target.code,
      address: target.address,
      preliminaryDate,
      surveyMethod: plan.survey_method === "field" ? "field" as const : "phone" as const,
      participantUserIds,
      responsibleUserId: Number(plan.responsible_user_id),
      reviewerUserId: plan.experienced_reviewer_id == null ? null : Number(plan.experienced_reviewer_id),
      writerUserId: writer?.id ?? null,
      protected: protectedIds.has(target.id),
    }];
  }).sort((left, right) => left.preliminaryDate.localeCompare(right.preliminaryDate)
    || naturalCode(left.businessCode, right.businessCode) || left.targetId - right.targetId);
  const actualMeasurementOccupancy = allTargets.flatMap((target) => target.days.map((day) => ({
    targetId: target.id,
    businessCode: target.code,
    address: target.address,
    date: day.date,
    participantUserIds: [...new Set([
      ...day.collaboratorUserIds,
      ...target.fixedAssignments.filter((fixed) => fixed.measurementDate === day.date).map((fixed) => fixed.assigneeUserId),
    ])].sort((left, right) => left - right),
  }))).sort((left, right) => left.date.localeCompare(right.date)
    || naturalCode(left.businessCode, right.businessCode) || left.targetId - right.targetId);
  const persistedAssignmentKeys = new Set<string>();
  const persistedPublicSampleAssignments = input.assignments.flatMap((assignment) => {
    const plan = input.plans.find((item) => String(item.id) === String(assignment.plan_id));
    const target = plan ? targetById.get(Number(plan.measurement_target_business_id)) : null;
    if (!target) return [];
    persistedAssignmentKeys.add(`${target.id}|${String(assignment.measurement_date)}`);
    return [{
      targetId: target.id,
      businessCode: target.code,
      measurementDate: String(assignment.measurement_date),
      assigneeUserId: Number(assignment.assignee_user_id),
      surveyCode: String(assignment.survey_code),
      publicSampleCode: assignment.public_sample_code == null ? null : String(assignment.public_sample_code),
      protected: protectedIds.has(target.id),
    }];
  });
  const fixedOnlyPublicSampleAssignments = input.fixedAssignments.flatMap((fixed) => {
    const target = targetById.get(Number(fixed.measurement_target_business_id));
    const assignee = userById.get(Number(fixed.assignee_user_id));
    const measurementDate = String(fixed.measurement_date);
    if (!target || !assignee?.baseCode || persistedAssignmentKeys.has(`${target.id}|${measurementDate}`)) return [];
    return [{
      targetId: target.id,
      businessCode: target.code,
      measurementDate,
      assigneeUserId: assignee.id,
      surveyCode: assignee.baseCode,
      publicSampleCode: null,
      protected: protectedIds.has(target.id),
    }];
  });
  const existingPublicSampleAssignments = [...persistedPublicSampleAssignments, ...fixedOnlyPublicSampleAssignments]
    .sort((left, right) => left.measurementDate.localeCompare(right.measurementDate)
      || left.assigneeUserId - right.assigneeUserId || naturalCode(left.businessCode, right.businessCode)
      || left.targetId - right.targetId);
  return {
    canonicalSha: PRELIMINARY_SURVEY_CANONICAL_SHA,
    plannerVersion: REVERSE_PLANNER_VERSION,
    targets,
    users,
    scheduleBlocks: input.scheduleBlocks.map((block) => ({
      userId: Number(block.user_id),
      startDate: String(block.start_date),
      endDate: String(block.end_date),
    })),
    routeEvidence: input.routeEvidence ?? [],
    existingSurveyOccupancy,
    actualMeasurementOccupancy,
    existingPublicSampleAssignments,
    writingCounters: Object.fromEntries(users.map((user) => [String(user.id),
      existingSurveyOccupancy.filter((occupancy) => !planningIds.has(occupancy.targetId) && occupancy.writerUserId === user.id).length])),
  };
}

const codeCollator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
function naturalCode(left: string, right: string) {
  return codeCollator.compare(left, right);
}
