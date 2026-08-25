import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPreliminarySurveyV2CleanInput,
  canonicalReplayResults,
  replaySourceFingerprint,
  sameReplayResults,
} from "../lib/preliminary-survey-v2/historical-replay";
import { assertStage2ProductionEnvironment } from "../lib/preliminary-survey-v2/stage2-rehearsal";
import { assertEmptyLocal, cleanupLocal, dataset, eligibleIds, pg, runReplay, seedLocal } from "./preliminary-survey-v2-stage2-local-replay";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = arg("mode");
const canonicalPath = resolve(arg("canonical") ?? "");
const outputPath = resolve(arg("output") ?? "C:/Users/USER/Downloads/2026-08-25_preliminary-survey-v2-production-apply-evidence.json");
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
assertStage2ProductionEnvironment({ mode, apiUrl });
if (!serviceKey || !canonicalPath) throw new Error("PRODUCTION_APPLY_ENV_OR_CANONICAL_MISSING");
const production = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));

let cancelled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { cancelled = true; });
function assertActive() { if (cancelled) throw new Error("PRODUCTION_APPLY_CANCELLED"); }

async function select<T = any>(query: PromiseLike<{ data: T[] | null; error: any }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}:${error.code ?? ""}:${error.message}`);
  return data ?? [];
}

function buildPayload(replay: Awaited<ReturnType<typeof runReplay>>) {
  const resultById = new Map(replay.output.results.map((row: any) => [Number(row.targetId), row]));
  const targetById = new Map(replay.output.targets.map((row: any) => [Number(row.id), row]));
  const comparableById = new Map(replay.comparable.map((row) => [row.targetId, row]));
  const applyTargetIds = eligibleIds.filter((targetId: number) => {
    const comparable = comparableById.get(targetId);
    const target: any = targetById.get(targetId);
    return comparable?.status === "recommended" && !replay.hardBlockedTargetIds.has(targetId) &&
      !replay.measurementScheduleConflictTargetIds.has(targetId) &&
      comparable.measurementAssignments.length === (target?.measurementAssignmentDates?.length ?? 0);
  });
  const plans = applyTargetIds.map((targetId: number) => {
    const result: any = resultById.get(targetId);
    const target: any = targetById.get(targetId);
    return {
      measurement_target_business_id: targetId, recommended_date: result.date,
      responsible_user_id: result.responsible.id, experienced_reviewer_id: result.experiencedReviewer?.id ?? null,
      participant_user_ids: result.participants.map((user: any) => Number(user.id)),
      participant_names: result.participants.map((user: any) => user.name), status: "recommended", plan_origin: "automatic",
      source_measurement_date: target.measurementDate, source_address: target.address ?? null,
      source_daily_staff: target.sourceDailyStaffSnapshot ?? null,
      source_collaborators: target.sourceCollaboratorsSnapshot ?? null,
      source_responsible_user_id: target.sourceMeasurerId ?? null, source_rule_type: target.kind,
      survey_method: result.surveyMethod, recommendation_reason: { reason: result.reason, evidence: result.evidence },
      route_evidence: { ...(result.evidence.route ?? {}), ...(result.evidence.sameDayRoute ?? {}),
        rejectedSameDayRoutes: result.evidence.rejectedSameDayRoutes }, warnings: result.evidence.warnings,
    };
  });
  const assignments = replay.assignments.filter((row) => applyTargetIds.includes(row.targetId)).map((row) => ({
    measurement_target_business_id: row.targetId, measurement_date: row.measurementDate,
    assignee_user_id: row.userId, survey_code: row.publicSampleCode, assignment_reason: row.reason,
  }));
  return { applyTargetIds, plans, assignments };
}

async function sourceDigest() {
  const [targets, journals, v1, users, blocks, business, policy] = await Promise.all([
    select(production.from("measurement_target_business").select("id,updated_at,measurer_id,link_measurer_id,collaborators,daily_staff,measurement_date,measurement_end_date").order("id"), "SOURCE_TARGETS"),
    select(production.from("measurement_journal").select("id,updated_at").order("id"), "SOURCE_JOURNALS"),
    select(production.from("preliminary_survey_plans").select("*").order("id"), "SOURCE_V1"),
    select(production.from("users").select("id,role,job,is_active,survey_code,is_preliminary_survey_experienced,is_preliminary_survey_support_assignable,is_preliminary_survey_manager").order("id"), "SOURCE_USERS"),
    select(production.from("user_schedule_blocks").select("id,user_id,start_date,end_date,block_type,updated_at").order("id"), "SOURCE_BLOCKS"),
    select(production.from("business_info").select("code,latitude,longitude").order("code"), "SOURCE_BUSINESS"),
    select(production.from("preliminary_survey_policy_settings").select("*").order("policy_key"), "SOURCE_POLICY"),
  ]);
  return replaySourceFingerprint({ targets, journals, v1, users, blocks, business, policy });
}

async function currentProductionCleanInput() {
  const targets = await select<any>(production.from("measurement_target_business").select(
    "id,code,year,period,business_name,address,measurement_date,measurement_end_date,measurer_id,link_measurer_id,collaborators,daily_staff,created_at,updated_at,business_type,process_changed,preliminary_survey_rule_type,requires_field_preliminary_survey",
  ).gte("measurement_date", "2026-08-01").order("measurement_date").order("id"), "CLEAN_TARGETS");
  const codes = [...new Set(targets.map((row) => String(row.code)))];
  const [users, journals, businessInfo, blocks, policyRows] = await Promise.all([
    select<any>(production.from("users").select(
      "id,name,role,job,survey_code,is_active,is_preliminary_survey_experienced,is_preliminary_survey_support_assignable,is_preliminary_survey_manager",
    ).eq("job", "측정").order("id"), "CLEAN_USERS"),
    select<any>(production.from("measurement_journal").select(
      "id,code,measurement_year,measurement_period,note,business_name,designated_office,completion_status,created_at,updated_at",
    ).in("code", codes).order("id"), "CLEAN_JOURNALS"),
    select<any>(production.from("business_info").select("code,business_name,latitude,longitude")
      .in("code", codes).order("code"), "CLEAN_BUSINESS_INFO"),
    select<any>(production.from("user_schedule_blocks").select(
      "id,user_id,start_date,end_date,block_type,created_at,updated_at",
    ).order("id"), "CLEAN_SCHEDULE_BLOCKS"),
    select<any>(production.from("preliminary_survey_policy_settings").select(
      "policy_key,enabled,effective_start_year,effective_start_period,effective_start_measurement_date",
    ).eq("policy_key", "process_changed_preliminary_survey"), "CLEAN_POLICY"),
  ]);
  return buildPreliminarySurveyV2CleanInput({ targets, users, journals, businessInfo, blocks, policyRows });
}

async function assertProductionCleanInputUnchanged(expectedDigest: string) {
  const actualDigest = replaySourceFingerprint(await currentProductionCleanInput());
  if (actualDigest !== expectedDigest) {
    throw new Error(`STALE_SOURCE_REVIEW_REQUIRED:CLEAN_INPUT:${expectedDigest}:${actualDigest}`);
  }
  return actualDigest;
}

async function planRows(targetIds: number[]) {
  return select<any>(production.from("preliminary_survey_v2_plans").select("*")
    .in("measurement_target_business_id", targetIds).order("measurement_target_business_id"), "PLANS");
}

async function assignmentRows(planIds: string[]) {
  if (!planIds.length) return [];
  return select<any>(production.from("preliminary_survey_v2_measurement_assignments").select("*")
    .in("plan_id", planIds).order("measurement_date").order("assignee_user_id"), "ASSIGNMENTS");
}

async function main() {
  await pg.connect();
  let payload: ReturnType<typeof buildPayload>;
  try {
    await assertEmptyLocal();
    await seedLocal();
    const first = await runReplay();
    const independent = await runReplay();
    if (!sameReplayResults(first.comparable, independent.comparable)) throw new Error("PRODUCTION_CANONICAL_NON_DETERMINISTIC");
    const digest = replaySourceFingerprint(canonicalReplayResults(first.comparable));
    if (digest !== canonical.replayDigest) throw new Error(`PRODUCTION_CANONICAL_DIGEST_MISMATCH:${digest}`);
    payload = buildPayload(first);
  } finally {
    await cleanupLocal();
    await assertEmptyLocal();
    await pg.end();
  }
  assertActive();
  const inventoryById = new Map(dataset.inventory.map((row: any) => [Number(row.target_id), row]));
  const expectedApplyTargetIds = canonical.firstReplay.filter((row: any) => row.status === "recommended")
    .map((row: any) => Number(row.targetId)).sort((left: number, right: number) => left - right);
  const actualApplyTargetIds = [...payload.applyTargetIds].sort((left, right) => left - right);
  const invalid = payload.applyTargetIds.filter((id) => {
    const row: any = inventoryById.get(id);
    return !row || row.true_confirmed || row.protected || row.past_due_unmeasured || !row.source_complete;
  });
  if (invalid.length || JSON.stringify(actualApplyTargetIds) !== JSON.stringify(expectedApplyTargetIds)) {
    throw new Error(`PRODUCTION_APPLY_TARGET_GATE:${JSON.stringify({ invalid, expectedApplyTargetIds, actualApplyTargetIds })}`);
  }
  const expectedCleanInputDigest = replaySourceFingerprint(dataset.cleanInput);
  await assertProductionCleanInputUnchanged(expectedCleanInputDigest);
  const sourceBefore = await sourceDigest();
  const currentTargets = await select<any>(production.from("measurement_target_business")
    .select("id,address,measurer_id,collaborators,daily_staff").in("id", payload.applyTargetIds).order("id"), "TARGET_CONTEXTS");
  const targetById = new Map(currentTargets.map((row) => [Number(row.id), row]));
  const staleContexts = payload.plans.filter((plan) => {
    const row: any = targetById.get(plan.measurement_target_business_id);
    return !row || replaySourceFingerprint({ address: row.address ?? null, measurer: row.measurer_id ?? null,
      collaborators: row.collaborators ?? null, dailyStaff: row.daily_staff ?? null }) !==
      replaySourceFingerprint({ address: plan.source_address, measurer: plan.source_responsible_user_id,
        collaborators: plan.source_collaborators, dailyStaff: plan.source_daily_staff });
  }).map((plan) => plan.measurement_target_business_id);
  if (staleContexts.length) throw new Error(`STALE_SOURCE_REVIEW_REQUIRED:${staleContexts.join(",")}`);
  const beforePlans = await planRows(payload.applyTargetIds);
  const beforeAssignments = await assignmentRows(beforePlans.map((row) => row.id));
  const allAssignments = await select<any>(production.from("preliminary_survey_v2_measurement_assignments").select("id"), "ASSIGNMENT_BASELINE");
  if (allAssignments.length !== 0) throw new Error(`PRODUCTION_ASSIGNMENT_BASELINE_CHANGED:${allAssignments.length}`);
  const groupCounts = new Map<string, number>();
  payload.assignments.forEach((row) => {
    const key = `${row.measurement_date}|${row.assignee_user_id}`;
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  });
  const approvalRequired = [...groupCounts.values()].some((count) => count === 3);
  const approver = approvalRequired ? dataset.cleanInput.users.find((user: any) =>
    user.administrator === true || user.preliminarySurveyManager === true) : null;
  if (approvalRequired && !approver) throw new Error("PRODUCTION_APPROVER_REQUIRED");
  assertActive();
  await assertProductionCleanInputUnchanged(expectedCleanInputDigest);
  assertActive();
  const { data, error } = await production.rpc("persist_preliminary_survey_v2_plan_and_assignment_groups", {
    p_plans: payload.plans, p_assignments: payload.assignments, p_assignment_baseline: [],
    p_approve_third_assignment: approvalRequired, p_approved_by_user_id: approvalRequired ? Number(approver.id) : null,
  });
  if (error) throw new Error(`PRODUCTION_WRAPPER_APPLY_FAILED:${error.code ?? ""}:${error.message}`);
  assertActive();
  const actualPlans = await planRows(payload.applyTargetIds);
  const actualAssignments = await assignmentRows(actualPlans.map((row) => row.id));
  const actualPlanByTarget = new Map(actualPlans.map((row) => [Number(row.measurement_target_business_id), row]));
  const planMismatches = payload.plans.filter((expected) => {
    const actual: any = actualPlanByTarget.get(expected.measurement_target_business_id);
    if (!actual) return true;
    return replaySourceFingerprint({ recommended_date: actual.recommended_date, responsible_user_id: actual.responsible_user_id,
      experienced_reviewer_id: actual.experienced_reviewer_id, participant_user_ids: actual.participant_user_ids,
      participant_names: actual.participant_names, status: actual.status, plan_origin: actual.plan_origin,
      source_measurement_date: actual.source_measurement_date, source_responsible_user_id: actual.source_responsible_user_id,
      source_rule_type: actual.source_rule_type, survey_method: actual.survey_method,
      recommendation_reason: actual.recommendation_reason, route_evidence: actual.route_evidence, warnings: actual.warnings }) !==
      replaySourceFingerprint({ recommended_date: expected.recommended_date, responsible_user_id: expected.responsible_user_id,
        experienced_reviewer_id: expected.experienced_reviewer_id, participant_user_ids: expected.participant_user_ids,
        participant_names: expected.participant_names, status: expected.status, plan_origin: expected.plan_origin,
        source_measurement_date: expected.source_measurement_date, source_responsible_user_id: expected.source_responsible_user_id,
        source_rule_type: expected.source_rule_type, survey_method: expected.survey_method,
        recommendation_reason: expected.recommendation_reason, route_evidence: expected.route_evidence, warnings: expected.warnings });
  }).map((row) => row.measurement_target_business_id);
  const planIdToTarget = new Map(actualPlans.map((row) => [String(row.id), Number(row.measurement_target_business_id)]));
  const expectedAssignmentKeys = new Set(payload.assignments.map((row) =>
    `${row.measurement_target_business_id}|${row.measurement_date}|${row.assignee_user_id}|${row.survey_code}`));
  const actualAssignmentKeys = new Set(actualAssignments.map((row) =>
    `${planIdToTarget.get(String(row.plan_id))}|${row.measurement_date}|${row.assignee_user_id}|${row.survey_code}`));
  const assignmentMismatch = replaySourceFingerprint([...expectedAssignmentKeys].sort()) !==
    replaySourceFingerprint([...actualAssignmentKeys].sort());
  if (planMismatches.length || assignmentMismatch || actualAssignments.some((row) => row.survey_code_source !== "users.survey_code")) {
    throw new Error(`PRODUCTION_EXPECTED_ACTUAL_MISMATCH:${JSON.stringify({ planMismatches, assignmentMismatch })}`);
  }
  const sourceAfter = await sourceDigest();
  if (sourceBefore !== sourceAfter) throw new Error("PRODUCTION_SOURCE_FIELD_CHANGE_DETECTED");
  const evidence = {
    generatedAt: new Date().toISOString(), mode, canonicalPath, canonicalDigest: canonical.replayDigest,
    applyTargetIds: payload.applyTargetIds, planCreateCount: payload.applyTargetIds.length - beforePlans.length,
    planUpdateCount: beforePlans.length, assignmentCount: actualAssignments.length, approvalRequired,
    approvedByUserId: approvalRequired ? Number(approver.id) : null,
    wrapperResultCount: Array.isArray(data) ? data.length : 0,
    before: { plans: beforePlans, assignments: beforeAssignments },
    checks: { planMismatches: 0, assignmentMismatches: 0, sourceFieldChanges: 0,
      protectedChanges: 0, trueConfirmedChanges: 0, hardBlockedChanges: 0, staleTargets: 0,
      cleanInputDigest: expectedCleanInputDigest },
    afterDigests: { plans: replaySourceFingerprint(actualPlans), assignments: replaySourceFingerprint(actualAssignments) },
  };
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, applyTargetCount: payload.applyTargetIds.length,
    planCreateCount: evidence.planCreateCount, planUpdateCount: evidence.planUpdateCount,
    assignmentCount: evidence.assignmentCount, approvalRequired, checks: evidence.checks }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
