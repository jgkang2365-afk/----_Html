import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { calculateV2Recommendations } from "../lib/preliminary-survey-v2/service";
import { assignMeasurementAssignees, buildMeasurementAssignmentTargets } from "../lib/preliminary-survey-v2/measurement-assignment";
import { recommendBatch } from "../lib/preliminary-survey-v2/engine";
import { recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import { buildScheduleBlockKeys } from "../lib/preliminary-survey-v2/availability";
import type { ExistingAssignment, SurveyUser } from "../lib/preliminary-survey-v2/types";

const PRODUCTION_REF = "xjxqbwvcgffunqnkmoqw";
const FROM = "2026-08-01";
const TO = "2026-08-31";
const outputPath = process.argv[2];

if (!outputPath) throw new Error("OUTPUT_PATH_REQUIRED");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!supabaseUrl.includes(PRODUCTION_REF) || !serviceRoleKey) throw new Error("PRODUCTION_ENVIRONMENT_REQUIRED");

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

function dailyDates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String((item as { date?: unknown })?.date ?? "")).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

function normalizedPeriod(value: unknown) {
  return String(value ?? "").replace("(수시)", "").trim();
}

function inScope(target: any) {
  return (String(target.measurement_date ?? "") >= FROM && String(target.measurement_date ?? "") <= TO) ||
    dailyDates(target.daily_staff).some((date) => date >= FROM && date <= TO);
}

async function main() {
const targetSelection = "id, code, year, period, business_name, address, measurement_date, measurement_end_date, measurer_id, collaborators, daily_staff, created_at, business_type, process_changed, preliminary_survey_rule_type, is_registered";
const { data: rawTargets, error: targetError } = await supabase.from("measurement_target_business").select(targetSelection)
  .eq("year", 2026).eq("period", "하반기");
if (targetError) throw targetError;
const targets = (rawTargets ?? []).filter(inScope).sort((left: any, right: any) =>
  String(left.measurement_date).localeCompare(String(right.measurement_date)) || String(left.code).localeCompare(String(right.code)));
const activeTargets = targets.filter((target: any) => String(target.is_registered).trim() === "실시");
const targetIds = activeTargets.map((target: any) => Number(target.id));
const codes = [...new Set(activeTargets.map((target: any) => String(target.code)))];

const [{ data: plans, error: planError }, { data: journals, error: journalError }, { data: users, error: userError }] = await Promise.all([
  targetIds.length ? supabase.from("preliminary_survey_v2_plans").select("*").in("measurement_target_business_id", targetIds) : Promise.resolve({ data: [], error: null }),
  codes.length ? supabase.from("measurement_journal").select("id, code, measurement_year, measurement_period").in("code", codes).eq("measurement_year", 2026) : Promise.resolve({ data: [], error: null }),
  supabase.from("users").select("id, name, job, is_active, is_preliminary_survey_experienced, survey_code").eq("job", "측정"),
]);
if (planError || journalError || userError) throw planError || journalError || userError;
const planIds = (plans ?? []).map((plan: any) => String(plan.id));
const { data: assignments, error: assignmentError } = planIds.length
  ? await supabase.from("preliminary_survey_v2_measurement_assignments").select("*").in("plan_id", planIds)
  : { data: [], error: null };
if (assignmentError) throw assignmentError;

const journalKeys = new Set((journals ?? []).map((journal: any) =>
  `${journal.code}|${journal.measurement_year}|${normalizedPeriod(journal.measurement_period)}`));
const targetById = new Map(activeTargets.map((target: any) => [Number(target.id), target]));
const planByTarget = new Map((plans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
const assignmentsByPlan = new Map<string, any[]>();
for (const assignment of assignments ?? []) assignmentsByPlan.set(String(assignment.plan_id), [
  ...(assignmentsByPlan.get(String(assignment.plan_id)) ?? []), assignment,
]);

// 이 함수와 아래 공시료 계산은 SELECT-only client만 사용하며 DB write/RPC를 호출하지 않는다.
const calculated = await calculateV2Recommendations(supabase, {
  targetIds,
  allowExternalRoutes: false,
  preserveManualPlans: false,
});

// Canonical §14의 8/31 회귀 fixture는 역할을 재최적화하지 않고 날짜만 전역 load에 맞춰 역산한다.
const august31Fixture = [
  { code: "H0028", responsibleUserId: 15, reviewerUserId: null, participantUserIds: [15] },
  { code: "H0033", responsibleUserId: 2, reviewerUserId: 15, participantUserIds: [2, 15] },
  { code: "H0195", responsibleUserId: 16, reviewerUserId: 13, participantUserIds: [16, 13] },
  { code: "H0049", responsibleUserId: 17, reviewerUserId: null, participantUserIds: [17] },
  { code: "H0361", responsibleUserId: 13, reviewerUserId: null, participantUserIds: [13] },
  { code: "H0130", responsibleUserId: 20, reviewerUserId: 13, participantUserIds: [20, 13] },
];
const fixtureCodes = new Set(august31Fixture.map((item) => item.code));
const surveyUsers: SurveyUser[] = (users ?? []).map((user: any) => ({
  id: Number(user.id), name: String(user.name), experienced: Boolean(user.is_preliminary_survey_experienced), active: user.is_active,
}));
const surveyUserById = new Map(surveyUsers.map((user) => [user.id, user]));
const candidateDates = recommendationDatesForBusinessType("2026-08-31", "existing").map((candidate) => candidate.date);
const { data: scheduleBlocks, error: scheduleBlockError } = await supabase.from("user_schedule_blocks")
  .select("user_id, start_date, end_date").lte("start_date", TO).gte("end_date", "2026-06-01");
if (scheduleBlockError) throw scheduleBlockError;
const scheduleBlockedKeys = buildScheduleBlockKeys(scheduleBlocks ?? []);
const fixedVirtual: ExistingAssignment[] = calculated.results.flatMap((result) => {
  const target = calculated.targets.find((item) => item.id === result.targetId);
  if (!target || fixtureCodes.has(target.code) || result.status !== "recommended" || !result.date) return [];
  return [{
    targetId: target.id, businessCode: target.code, kind: target.kind, date: result.date,
    participants: result.participants.map((user) => user.id), responsibleUserId: result.responsible.id,
    experiencedReviewerId: result.experiencedReviewer?.id ?? null, surveyMethod: result.surveyMethod,
    address: target.address, coordinate: target.coordinate, region: target.region,
  }];
});
const fixedResults = [];
for (const fixed of august31Fixture) {
  const target = calculated.targets.find((item) => item.code === fixed.code);
  const responsible = surveyUserById.get(fixed.responsibleUserId);
  const reviewer = fixed.reviewerUserId == null ? null : surveyUserById.get(fixed.reviewerUserId);
  if (!target || !responsible || (fixed.reviewerUserId != null && !reviewer)) throw new Error(`FIXTURE_CONTEXT_MISSING:${fixed.code}`);
  const [result] = await recommendBatch({
    targets: [{ ...target, responsible }],
    experiencedUsers: reviewer ? [reviewer] : [],
    existingAssignments: fixedVirtual,
    availability: {
      isBlocked: (userId, date) => scheduleBlockedKeys.has(`${userId}:${date}`),
      isScheduleBlocked: (userId, date) => scheduleBlockedKeys.has(`${userId}:${date}`),
      isActualMeasurementBlocked: () => false,
    },
    routes: { between: async () => ({ source: "unknown", durationMinutes: null, distanceKm: null, sameRegion: false }) },
  });
  if (result.status !== "recommended" ||
      JSON.stringify(result.participants.map((user) => user.id)) !== JSON.stringify(fixed.participantUserIds)) {
    throw new Error(`FIXTURE_RECALCULATION_FAILED:${fixed.code}`);
  }
  fixedResults.push(result);
  fixedVirtual.push({
    targetId: target.id, businessCode: target.code, kind: target.kind, date: result.date!,
    participants: fixed.participantUserIds, responsibleUserId: fixed.responsibleUserId,
    experiencedReviewerId: fixed.reviewerUserId, surveyMethod: "phone",
    address: target.address, coordinate: target.coordinate, region: target.region,
  });
}
calculated.results = [
  ...calculated.results.filter((result) => !fixtureCodes.has(calculated.targets.find((target) => target.id === result.targetId)?.code ?? "")),
  ...fixedResults,
].sort((left, right) => left.targetId - right.targetId);
const resultByTarget = new Map(calculated.results.map((result) => [result.targetId, result]));

const measurementTargets = calculated.results.flatMap((result) => {
  const target = calculated.targets.find((item) => item.id === result.targetId);
  if (!target || result.status !== "recommended") return [];
  return buildMeasurementAssignmentTargets({
    target,
    preliminarySurveyorUserIds: result.participants.map((user) => user.id),
  });
});
const operationalUsers = (users ?? []).filter((user: any) => user.is_active !== false && user.survey_code).map((user: any) => ({
  id: Number(user.id), name: String(user.name), active: user.is_active, surveyCode: String(user.survey_code),
}));
let proposedAssignments: ReturnType<typeof assignMeasurementAssignees> = [];
let assignmentCalculationError: string | null = null;
try {
  proposedAssignments = assignMeasurementAssignees({ targets: measurementTargets, users: operationalUsers });
} catch (error) {
  assignmentCalculationError = error instanceof Error ? error.message : String(error);
}
const proposedAssignmentsByTarget = new Map<number, typeof proposedAssignments>();
for (const assignment of proposedAssignments) proposedAssignmentsByTarget.set(assignment.targetId, [
  ...(proposedAssignmentsByTarget.get(assignment.targetId) ?? []), assignment,
]);

const protectedCodes = new Set(["H0399", "H0524", "H0288", "H0528", "H0348", "H0126", "H0281", "H0260", "H0063", "H0077"]);
const rows = activeTargets.map((target: any) => {
  const id = Number(target.id);
  const currentPlan: any = planByTarget.get(id) ?? null;
  const result = resultByTarget.get(id) ?? null;
  const trueConfirmed = journalKeys.has(`${target.code}|${target.year}|${normalizedPeriod(target.period)}`);
  const currentAssignments = currentPlan ? assignmentsByPlan.get(String(currentPlan.id)) ?? [] : [];
  const proposed = proposedAssignmentsByTarget.get(id) ?? [];
  const currentParticipantIds = [...(currentPlan?.participant_user_ids ?? [])].map(Number).sort((a, b) => a - b);
  const proposedParticipantIds = result?.participants.map((user) => user.id).sort((a, b) => a - b) ?? [];
  const roleOrMethodConflict = Boolean(currentPlan && result?.status === "recommended" && (
    Number(currentPlan.responsible_user_id) !== result.responsible.id ||
    Number(currentPlan.experienced_reviewer_id ?? 0) !== Number(result.experiencedReviewer?.id ?? 0) ||
    JSON.stringify(currentParticipantIds) !== JSON.stringify(proposedParticipantIds) ||
    currentPlan.survey_method !== result.surveyMethod
  ));
  const conflictingAssignments = currentAssignments.some((current: any) => {
    const next = proposed.find((item) => item.measurementDate === current.measurement_date);
    return !next || Number(current.assignee_user_id) !== next.userId || current.survey_code !== next.publicSampleCode;
  });
  const missingAssignments = proposed.some((next) => !currentAssignments.some((current: any) =>
    current.measurement_date === next.measurementDate));
  const dateConflict = Boolean(currentPlan && result?.status === "recommended" && currentPlan.recommended_date !== result.date);
  const planMatches = Boolean(currentPlan && result?.status === "recommended" &&
    currentPlan.recommended_date === result.date &&
    Number(currentPlan.responsible_user_id) === result.responsible.id &&
    Number(currentPlan.experienced_reviewer_id ?? 0) === Number(result.experiencedReviewer?.id ?? 0) &&
    JSON.stringify([...(currentPlan.participant_user_ids ?? [])].map(Number).sort((a, b) => a - b)) ===
      JSON.stringify(result.participants.map((user) => user.id).sort((a, b) => a - b)) &&
    currentPlan.survey_method === result.surveyMethod);
  const assignmentMatches = currentAssignments.length === proposed.length && proposed.every((next) =>
    currentAssignments.some((current: any) => current.measurement_date === next.measurementDate &&
      Number(current.assignee_user_id) === next.userId && current.survey_code === next.publicSampleCode));
  const action = result?.status !== "recommended" || assignmentCalculationError
    ? "REVIEW_REQUIRED"
    : planMatches && assignmentMatches ? "KEEP"
      : protectedCodes.has(String(target.code)) ? "REVIEW_REQUIRED"
        : trueConfirmed
          ? !currentPlan || (!roleOrMethodConflict && !conflictingAssignments && (dateConflict || missingAssignments))
            ? "REPAIR"
            : "REVIEW_REQUIRED"
          : !currentPlan ? "INSERT" : "UPDATE";
  return {
    targetId: id, code: target.code, businessName: target.business_name, businessType: target.business_type,
    lifecycle: target.is_registered, measurementDate: target.measurement_date, measurementDates: dailyDates(target.daily_staff),
    trueConfirmed, currentPlan: currentPlan ? {
      id: currentPlan.id, date: currentPlan.recommended_date, responsibleUserId: currentPlan.responsible_user_id,
      reviewerUserId: currentPlan.experienced_reviewer_id, participantUserIds: currentPlan.participant_user_ids,
      method: currentPlan.survey_method, status: currentPlan.status, origin: currentPlan.plan_origin,
      assignments: currentAssignments.map((item: any) => ({ date: item.measurement_date, userId: item.assignee_user_id, code: item.survey_code })),
    } : null,
    proposed: result ? {
      status: result.status, date: result.date, responsibleUserId: result.responsible.id,
      reviewerUserId: result.experiencedReviewer?.id ?? null,
      participantUserIds: result.participants.map((user) => user.id), method: result.surveyMethod,
      assignments: proposed.map((item) => ({ date: item.measurementDate, userId: item.userId, code: item.publicSampleCode })),
      reason: result.reason,
    } : null,
    differences: { dateConflict, roleOrMethodConflict, missingAssignments, conflictingAssignments },
    action,
  };
});

const proposedExistingPhone = rows.filter((row) => row.businessType === "existing" && row.proposed?.status === "recommended" &&
  row.proposed.method === "phone" && row.proposed.date);
const dateLoad = new Map<string, number>();
const responsibleLoad = new Map<string, number>();
for (const row of proposedExistingPhone) {
  dateLoad.set(row.proposed!.date!, (dateLoad.get(row.proposed!.date!) ?? 0) + 1);
  const key = `${row.proposed!.date}|${row.proposed!.responsibleUserId}`;
  responsibleLoad.set(key, (responsibleLoad.get(key) ?? 0) + 1);
}
const dateDistributionViolations = proposedExistingPhone.flatMap((row) => {
  const candidates = recommendationDatesForBusinessType(String(row.measurementDate), "existing");
  const primary = candidates.filter((candidate) => candidate.workingDaysBefore <= 20);
  const eligiblePrimary = primary.filter((candidate) =>
    !scheduleBlockedKeys.has(`${row.proposed!.responsibleUserId}:${candidate.date}`) &&
    (responsibleLoad.get(`${candidate.date}|${row.proposed!.responsibleUserId}`) ?? 0) - Number(candidate.date === row.proposed!.date) < 3);
  const eligible = eligiblePrimary.length > 0 ? eligiblePrimary : candidates.filter((candidate) =>
    candidate.workingDaysBefore > 20 && !scheduleBlockedKeys.has(`${row.proposed!.responsibleUserId}:${candidate.date}`) &&
    (responsibleLoad.get(`${candidate.date}|${row.proposed!.responsibleUserId}`) ?? 0) - Number(candidate.date === row.proposed!.date) < 3);
  const selectedOtherLoad = (dateLoad.get(row.proposed!.date!) ?? 0) - 1;
  const lowerLoadCandidate = eligible.find((candidate) =>
    (dateLoad.get(candidate.date) ?? 0) - Number(candidate.date === row.proposed!.date) < selectedOtherLoad);
  return lowerLoadCandidate ? [{ code: row.code, selectedDate: row.proposed!.date, selectedOtherLoad, lowerLoadDate: lowerLoadCandidate.date,
    lowerLoad: dateLoad.get(lowerLoadCandidate.date) ?? 0 }] : [];
});
const nonExperiencedSolo = proposedExistingPhone.filter((row) => {
  const participantIds = row.proposed!.participantUserIds;
  return participantIds.length === 1 && surveyUserById.get(Number(participantIds[0]))?.experienced === false;
});
const responsibleOverCapacity = [...responsibleLoad.entries()].filter(([, count]) => count > 3)
  .map(([key, count]) => ({ key, count }));

const report = {
  generatedAt: new Date().toISOString(), environment: "Production READ-ONLY", projectRef: PRODUCTION_REF,
  measurementDateScope: { from: FROM, to: TO, basis: "measurement scheduled date inclusive" },
  writeOperations: 0,
  counts: {
    inventory: targets.length, active: activeTargets.length, excluded: targets.length - activeTargets.length,
    existing: activeTargets.filter((target: any) => target.business_type === "existing").length,
    firstMeasurement: activeTargets.filter((target: any) => target.business_type === "first_measurement").length,
    externalNew: activeTargets.filter((target: any) => target.business_type === "external_new").length,
    multiDay: activeTargets.filter((target: any) => dailyDates(target.daily_staff).length > 1).length,
    trueConfirmed: rows.filter((row) => row.trueConfirmed).length,
    actions: Object.fromEntries(["KEEP", "INSERT", "UPDATE", "REPAIR", "REVIEW_REQUIRED"].map((action) =>
      [action, rows.filter((row) => row.action === action).length])),
  },
  assignmentCalculationError,
  validations: {
    existingPhoneNull: rows.filter((row) => row.businessType === "existing" && row.proposed?.date == null).map((row) => row.code),
    nonExperiencedSolo: nonExperiencedSolo.map((row) => row.code),
    responsibleOverCapacity,
    dateDistributionViolations,
    proposedPublicSampleThirdAssignments: proposedAssignments.filter((assignment) => assignment.approvalRequired).length,
  },
  excluded: targets.filter((target: any) => String(target.is_registered).trim() !== "실시").map((target: any) => ({
    targetId: target.id, code: target.code, lifecycle: target.is_registered, measurementDate: target.measurement_date,
  })),
  rows,
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...report.counts, assignmentCalculationError, validations: report.validations }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
