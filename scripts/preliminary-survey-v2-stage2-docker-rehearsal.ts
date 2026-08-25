import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalReplayResults,
  replaySourceFingerprint,
  sameReplayResults,
} from "../lib/preliminary-survey-v2/historical-replay";
import {
  assignmentGroupFingerprint,
  assertLocalDockerRehearsalEnvironment,
  stableJsonDigest,
} from "../lib/preliminary-survey-v2/stage2-rehearsal";
import {
  assertEmptyLocal,
  cleanupLocal,
  dataset,
  eligibleIds,
  installV1Probe,
  pg,
  runReplay,
  seedLocal,
  supabase,
} from "./preliminary-survey-v2-stage2-local-replay";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = arg("mode");
const inputPath = resolve(arg("input") || "C:/Users/USER/Downloads/2026-08-25_stage2-2b1-production-inventory-recheck.json");
const canonicalPath = resolve(arg("canonical") || "C:/Users/USER/Downloads/2026-08-25_stage2-2b1-canonical-replay.json");
const outputPath = resolve(arg("output") || "C:/Users/USER/Downloads/2026-08-25_stage2-2b1-docker-apply-manifest.json");
const localDbUrl = process.env.STAGE2_LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const localApiUrl = process.env.STAGE2_LOCAL_API_URL || "http://127.0.0.1:54321";

assertLocalDockerRehearsalEnvironment({
  mode,
  databaseUrl: localDbUrl,
  apiUrl: localApiUrl,
  environmentValues: [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL],
});

const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { interrupted = true; });
}
function assertNotInterrupted() {
  if (interrupted) throw new Error("REHEARSAL_CANCELLED");
}

async function prerequisites() {
  const result = await pg.query(`SELECT json_build_object(
    'plan_table', to_regclass('public.preliminary_survey_v2_plans') IS NOT NULL,
    'assignment_table', to_regclass('public.preliminary_survey_v2_measurement_assignments') IS NOT NULL,
    'survey_code_column', EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='survey_code'
    ),
    'wrapper_exists', to_regprocedure('public.persist_preliminary_survey_v2_plan_and_assignment_groups(jsonb,jsonb,jsonb,boolean,integer)') IS NOT NULL,
    'core_exists', to_regprocedure('public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb,jsonb,jsonb,boolean,integer)') IS NOT NULL,
    'wrapper_service_role_execute', has_function_privilege('service_role', 'public.persist_preliminary_survey_v2_plan_and_assignment_groups(jsonb,jsonb,jsonb,boolean,integer)', 'EXECUTE'),
    'core_service_role_execute', has_function_privilege('service_role', 'public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb,jsonb,jsonb,boolean,integer)', 'EXECUTE'),
    'plan_guard', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.preliminary_survey_v2_plans'::regclass AND NOT tgisinternal AND tgname ILIKE '%true_confirmed%'),
    'assignment_guard', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.preliminary_survey_v2_measurement_assignments'::regclass AND NOT tgisinternal AND tgname ILIKE '%true_confirmed%'),
    'assignment_validation', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.preliminary_survey_v2_measurement_assignments'::regclass AND NOT tgisinternal AND tgname ILIKE '%valid%')
  ) AS value`);
  const value = result.rows[0].value;
  if (Object.entries(value).some(([key, enabled]) => key === "core_service_role_execute" ? enabled !== false : enabled !== true)) {
    throw new Error(`DOCKER_PREREQUISITE_MISMATCH:${JSON.stringify(value)}`);
  }
  return value;
}

async function rows(sql: string, params: unknown[] = []) {
  return (await pg.query(sql, params)).rows;
}

async function sourceSnapshot() {
  const definitions = [
    ["targets", "SELECT * FROM public.measurement_target_business ORDER BY id"],
    ["journals", "SELECT * FROM public.measurement_journal ORDER BY id"],
    ["v1", "SELECT * FROM public.preliminary_survey_plans ORDER BY id"],
    ["blocks", "SELECT * FROM public.user_schedule_blocks ORDER BY id"],
    ["users", "SELECT * FROM public.users ORDER BY id"],
    ["business", "SELECT * FROM public.business_info ORDER BY code"],
    ["policy", "SELECT * FROM public.preliminary_survey_policy_settings ORDER BY policy_key"],
  ] as const;
  const snapshots: Array<[string, string]> = [];
  for (const [name, sql] of definitions) snapshots.push([name, replaySourceFingerprint(await rows(sql))]);
  return Object.fromEntries(snapshots);
}

async function planState(targetIds: number[]) {
  if (!targetIds.length) return [];
  return rows(`SELECT measurement_target_business_id,recommended_date::text,responsible_user_id,
    experienced_reviewer_id,participant_user_ids,participant_names,status,plan_origin,
    source_measurement_date::text,source_responsible_user_id,source_rule_type,survey_method,
    recommendation_reason,route_evidence,warnings,created_at,updated_at
    FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = ANY($1::bigint[]) ORDER BY measurement_target_business_id`, [targetIds]);
}

async function assignmentState(targetIds: number[]) {
  if (!targetIds.length) return [];
  return rows(`SELECT p.measurement_target_business_id,a.measurement_date::text,a.assignee_user_id,
    a.survey_code,a.survey_code_source,a.assignment_reason,a.approval_required,
    a.approval_group_fingerprint,a.approved_by_user_id,a.approved_at,a.created_at,a.updated_at
    FROM public.preliminary_survey_v2_measurement_assignments a
    JOIN public.preliminary_survey_v2_plans p ON p.id=a.plan_id
    WHERE p.measurement_target_business_id = ANY($1::bigint[])
    ORDER BY p.measurement_target_business_id,a.measurement_date`, [targetIds]);
}

function stableRowsForWriteGuard(value: any[]) {
  return value.map(({ created_at: _created, updated_at: _updated, ...row }) => row);
}

function validateCanonicalSource() {
  const inventoryById = new Map(dataset.inventory.map((row: any) => [Number(row.target_id), row]));
  const manifestById = new Map(canonical.manifest.map((row: any) => [Number(row.target_id), row]));
  const duplicateIds = canonical.manifest.map((row: any) => Number(row.target_id))
    .filter((id: number, index: number, all: number[]) => all.indexOf(id) !== index);
  const stale = eligibleIds.filter((id: number) => {
    const inventory: any = inventoryById.get(id);
    const manifest: any = manifestById.get(id);
    return !manifest || manifest.source_fingerprint !== inventory?.source_fingerprint;
  });
  const replayIds = canonical.firstReplay.map((row: any) => Number(row.targetId)).sort((a: number, b: number) => a - b);
  const expectedIds = [...eligibleIds].sort((a, b) => a - b);
  const invalidProposals = canonical.manifest.filter((row: any) =>
    (row.true_confirmed || row.protected) && row.replay_date != null);
  if (duplicateIds.length || stale.length || JSON.stringify(replayIds) !== JSON.stringify(expectedIds) || invalidProposals.length ||
      dataset.summary.sourceIncomplete !== 0) {
    throw new Error(`CANONICAL_SOURCE_GATE_FAILED:${JSON.stringify({ duplicateIds, stale, invalidProposals: invalidProposals.map((row: any) => row.target_id) })}`);
  }
  return { staleTargetIds: stale, duplicateIds, replayTargetCount: replayIds.length };
}

function buildPayload(replay: Awaited<ReturnType<typeof runReplay>>) {
  const resultById = new Map(replay.output.results.map((result: any) => [Number(result.targetId), result]));
  const targetById = new Map(replay.output.targets.map((target: any) => [Number(target.id), target]));
  const comparableById = new Map(replay.comparable.map((result) => [result.targetId, result]));
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
      measurement_target_business_id: targetId,
      recommended_date: result.date,
      responsible_user_id: result.responsible.id,
      experienced_reviewer_id: result.experiencedReviewer?.id ?? null,
      participant_user_ids: result.participants.map((user: any) => Number(user.id)),
      participant_names: result.participants.map((user: any) => user.name),
      status: "recommended",
      plan_origin: result.evidence.warnings.includes("MINIMUM_CHANGE_PRESERVED") ? "manual" : "automatic",
      source_measurement_date: target.measurementDate,
      source_address: target.address ?? null,
      source_daily_staff: target.sourceDailyStaffSnapshot ?? null,
      source_collaborators: target.sourceCollaboratorsSnapshot ?? null,
      source_responsible_user_id: target.sourceMeasurerId ?? null,
      source_rule_type: target.kind,
      survey_method: result.surveyMethod,
      recommendation_reason: { reason: result.reason, evidence: result.evidence },
      route_evidence: {
        ...(result.evidence.route ?? {}),
        ...(result.evidence.sameDayRoute ?? {}),
        rejectedSameDayRoutes: result.evidence.rejectedSameDayRoutes,
      },
      warnings: result.evidence.warnings,
    };
  });
  const assignments = replay.assignments.filter((assignment) => applyTargetIds.includes(assignment.targetId)).map((assignment) => ({
    measurement_target_business_id: assignment.targetId,
    measurement_date: assignment.measurementDate,
    assignee_user_id: assignment.userId,
    survey_code: assignment.publicSampleCode,
    assignment_reason: assignment.reason,
  }));
  return { applyTargetIds, plans, assignments };
}

async function assignmentBaseline(payload: ReturnType<typeof buildPayload>) {
  const dates = [...new Set(payload.assignments.map((row) => row.measurement_date))];
  if (!dates.length) return [];
  return rows(`SELECT p.measurement_target_business_id AS "targetId",a.measurement_date::text AS "measurementDate",
    a.assignee_user_id AS "userId" FROM public.preliminary_survey_v2_measurement_assignments a
    JOIN public.preliminary_survey_v2_plans p ON p.id=a.plan_id
    WHERE a.measurement_date = ANY($1::date[]) AND NOT (p.measurement_target_business_id = ANY($2::bigint[]))
    ORDER BY p.measurement_target_business_id,a.measurement_date,a.assignee_user_id`, [dates, payload.applyTargetIds]);
}

async function callWrapper(payload: ReturnType<typeof buildPayload>, baseline: any[], approve: boolean, approverId: number | null) {
  return supabase.rpc("persist_preliminary_survey_v2_plan_and_assignment_groups", {
    p_plans: payload.plans,
    p_assignments: payload.assignments,
    p_assignment_baseline: baseline,
    p_approve_third_assignment: approve,
    p_approved_by_user_id: approve ? approverId : null,
  });
}

async function verifyIsolatedExactThreeApproval(
  payload: ReturnType<typeof buildPayload>,
  approverId: number,
) {
  const byDate = new Map<string, typeof payload.assignments>();
  payload.assignments.forEach((assignment) => {
    byDate.set(assignment.measurement_date, [...(byDate.get(assignment.measurement_date) ?? []), assignment]);
  });
  const sourceGroup = [...byDate.values()].find((group) => group.length >= 3);
  if (!sourceGroup) throw new Error("ISOLATED_EXACT_THREE_SOURCE_REQUIRED");
  const selected = [...sourceGroup].sort((left, right) =>
    left.measurement_target_business_id - right.measurement_target_business_id).slice(0, 3);
  const date = selected[0].measurement_date;
  const cleanUser = dataset.cleanInput.users.find((user: any) => user.active !== false &&
    ["A", "B", "C", "D", "F", "G"].includes(user.surveyCode) &&
    !dataset.cleanInput.scheduleBlocks.some((block: any) => Number(block.userId) === Number(user.id) &&
      block.startDate <= date && block.endDate >= date));
  if (!cleanUser) throw new Error("ISOLATED_EXACT_THREE_ASSIGNEE_REQUIRED");
  const targetIds = selected.map((row) => row.measurement_target_business_id);
  const probe = {
    applyTargetIds: targetIds,
    plans: payload.plans.filter((plan) => targetIds.includes(plan.measurement_target_business_id)),
    assignments: selected.map((assignment) => ({
      ...assignment, assignee_user_id: Number(cleanUser.id), survey_code: cleanUser.surveyCode,
    })),
  };
  const before = { plans: await planState(targetIds), assignments: await assignmentState(targetIds) };
  const rejected = await callWrapper(probe, [], false, null);
  if (!rejected.error?.message.includes("MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED")) {
    throw new Error(`ISOLATED_APPROVAL_REJECTION_FAILED:${rejected.error?.message ?? "NO_ERROR"}`);
  }
  const afterRejected = { plans: await planState(targetIds), assignments: await assignmentState(targetIds) };
  if (stableJsonDigest(before) !== stableJsonDigest(afterRejected)) throw new Error("ISOLATED_APPROVAL_REJECTION_NOT_ATOMIC");
  const approved = await callWrapper(probe, [], true, approverId);
  if (approved.error) throw new Error(`ISOLATED_APPROVAL_APPLY_FAILED:${approved.error.message}`);
  const approvalRows = await assignmentState(targetIds);
  const expectedFingerprint = assignmentGroupFingerprint({
    measurementDate: date,
    assigneeUserId: Number(cleanUser.id),
    targetIds,
  });
  const approvalRow = approvalRows.find((row: any) => row.approval_required === true);
  if (approvalRows.length !== 3 || approvalRows.filter((row: any) => row.approval_required === true).length !== 1 ||
      approvalRow?.approved_by_user_id !== approverId || approvalRow?.approval_group_fingerprint !== expectedFingerprint ||
      approvalRow?.approved_at == null) {
    throw new Error(`ISOLATED_APPROVAL_METADATA_MISMATCH:${JSON.stringify(approvalRows)}`);
  }
  await pg.query("BEGIN");
  try {
    await pg.query(`DELETE FROM public.preliminary_survey_v2_measurement_assignments a USING public.preliminary_survey_v2_plans p
      WHERE a.plan_id=p.id AND p.measurement_target_business_id = ANY($1::bigint[])`, [targetIds]);
    await pg.query("DELETE FROM public.preliminary_survey_v2_plans WHERE measurement_target_business_id = ANY($1::bigint[])", [targetIds]);
    await pg.query("COMMIT");
  } catch (error) {
    await pg.query("ROLLBACK");
    throw error;
  }
  const afterCleanup = { plans: await planState(targetIds), assignments: await assignmentState(targetIds) };
  if (stableJsonDigest(before) !== stableJsonDigest(afterCleanup)) throw new Error("ISOLATED_APPROVAL_CLEANUP_FAILED");
  return { targetIds, measurementDate: date, assigneeUserId: Number(cleanUser.id), approverId,
    expectedFingerprint, actualFingerprint: approvalRow.approval_group_fingerprint,
    rollbackAtomic: true, approved: true, cleanup: true };
}

function expectedPlanRows(payload: ReturnType<typeof buildPayload>) {
  return payload.plans.map((plan) => ({
    measurement_target_business_id: plan.measurement_target_business_id,
    recommended_date: plan.recommended_date,
    responsible_user_id: plan.responsible_user_id,
    experienced_reviewer_id: plan.experienced_reviewer_id,
    participant_user_ids: plan.participant_user_ids,
    participant_names: plan.participant_names,
    status: plan.status,
    plan_origin: plan.plan_origin,
    source_measurement_date: plan.source_measurement_date,
    source_responsible_user_id: plan.source_responsible_user_id,
    source_rule_type: plan.source_rule_type,
    survey_method: plan.survey_method,
    recommendation_reason: plan.recommendation_reason,
    route_evidence: plan.route_evidence,
    warnings: plan.warnings,
  })).sort((left, right) => left.measurement_target_business_id - right.measurement_target_business_id);
}

async function verifySourceContexts(payload: ReturnType<typeof buildPayload>) {
  const actual = await rows(`SELECT id,address,daily_staff,collaborators
    FROM public.measurement_target_business WHERE id = ANY($1::bigint[]) ORDER BY id`, [payload.applyTargetIds]);
  const expected = payload.plans.map((plan) => ({
    id: String(plan.measurement_target_business_id),
    address: plan.source_address,
    daily_staff: plan.source_daily_staff,
    collaborators: plan.source_collaborators,
  })).sort((left, right) => Number(left.id) - Number(right.id));
  return expected.map((row, index) => ({ expected: row, actual: actual[index] }))
    .filter((item) => replaySourceFingerprint(item.expected) !== replaySourceFingerprint(item.actual));
}

function expectedAssignmentRows(payload: ReturnType<typeof buildPayload>, approverId: number) {
  const groups = new Map<string, typeof payload.assignments>();
  for (const assignment of payload.assignments) {
    const key = `${assignment.measurement_date}|${assignment.assignee_user_id}`;
    groups.set(key, [...(groups.get(key) ?? []), assignment]);
  }
  return payload.assignments.map((assignment) => {
    const group = [...groups.get(`${assignment.measurement_date}|${assignment.assignee_user_id}`)!]
      .sort((left, right) => left.measurement_target_business_id - right.measurement_target_business_id);
    const approvedRow = group.length === 3 && group.at(-1)!.measurement_target_business_id === assignment.measurement_target_business_id;
    const fingerprint = group.length === 3 ? assignmentGroupFingerprint({
      measurementDate: assignment.measurement_date,
      assigneeUserId: assignment.assignee_user_id,
      targetIds: group.map((row) => row.measurement_target_business_id),
    }) : null;
    return {
      measurement_target_business_id: assignment.measurement_target_business_id,
      measurement_date: assignment.measurement_date,
      assignee_user_id: assignment.assignee_user_id,
      survey_code: assignment.survey_code,
      survey_code_source: "users.survey_code",
      assignment_reason: assignment.assignment_reason,
      approval_required: approvedRow,
      approval_group_fingerprint: approvedRow ? fingerprint : null,
      approved_by_user_id: approvedRow ? approverId : null,
      approved_at_present: approvedRow,
    };
  }).sort((left, right) => left.measurement_target_business_id - right.measurement_target_business_id ||
    left.measurement_date.localeCompare(right.measurement_date));
}

async function verifyAssignments(payload: ReturnType<typeof buildPayload>, approverId: number) {
  const actual = await assignmentState(payload.applyTargetIds);
  const actualComparable = actual.map(({ created_at: _created, updated_at: _updated, approved_at, ...row }) => ({
    ...row, measurement_target_business_id: Number(row.measurement_target_business_id),
    approved_at_present: approved_at != null,
  }));
  const expected = expectedAssignmentRows(payload, approverId);
  const mismatches = expected.map((row, index) => ({ expected: row, actual: actualComparable[index] }))
    .filter((item) => replaySourceFingerprint(item.expected) !== replaySourceFingerprint(item.actual));
  const scheduleConflicts = await rows(`SELECT p.measurement_target_business_id,a.measurement_date::text,a.assignee_user_id
    FROM public.preliminary_survey_v2_measurement_assignments a
    JOIN public.preliminary_survey_v2_plans p ON p.id=a.plan_id
    JOIN public.user_schedule_blocks b ON b.user_id=a.assignee_user_id
      AND b.start_date <= a.measurement_date AND b.end_date >= a.measurement_date
    WHERE p.measurement_target_business_id = ANY($1::bigint[])`, [payload.applyTargetIds]);
  const grouped = new Map<string, number>();
  for (const row of payload.assignments) {
    const key = `${row.measurement_date}|${row.assignee_user_id}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  const groupCounts = [...grouped.values()];
  return { actual, expected, mismatches, scheduleConflicts, hardMaxGroups: groupCounts.filter((count) => count >= 4).length };
}

async function main() {
  const sourceGate = validateCanonicalSource();
  await pg.connect();
  const initialCounts = await assertEmptyLocal();
  let finalCounts: any;
  let evidence: any;
  try {
    const prerequisite = await prerequisites();
    assertNotInterrupted();
    await seedLocal();
    const sourceBefore = await sourceSnapshot();
    const protectedOrConfirmedIds = dataset.inventory.filter((row: any) => row.protected || row.true_confirmed)
      .map((row: any) => Number(row.target_id));
    const protectedBefore = {
      plans: await planState(protectedOrConfirmedIds), assignments: await assignmentState(protectedOrConfirmedIds),
    };
    const first = await runReplay();
    const independent = await runReplay();
    const canonicalDigest = replaySourceFingerprint(canonicalReplayResults(first.comparable));
    if (canonicalDigest !== canonical.replayDigest || !sameReplayResults(first.comparable, independent.comparable)) {
      throw new Error(`CANONICAL_REPLAY_MISMATCH:${canonicalDigest}:${canonical.replayDigest}`);
    }
    const payload = buildPayload(first);
    const hardBlockedTargetIds = [...first.hardBlockedTargetIds].sort((a, b) => a - b);
    const hardBefore = { plans: await planState(hardBlockedTargetIds), assignments: await assignmentState(hardBlockedTargetIds) };
    const beforeCandidatePlans = await planState(payload.applyTargetIds);
    const beforeCandidateAssignments = await assignmentState(payload.applyTargetIds);
    const baseline = await assignmentBaseline(payload);
    const beforeRollbackDigest = stableJsonDigest({ plans: beforeCandidatePlans, assignments: beforeCandidateAssignments });
    const assignmentGroupSizes = new Map<string, number>();
    payload.assignments.forEach((assignment) => {
      const key = `${assignment.measurement_date}|${assignment.assignee_user_id}`;
      assignmentGroupSizes.set(key, (assignmentGroupSizes.get(key) ?? 0) + 1);
    });
    const approvalRequired = [...assignmentGroupSizes.values()].some((count) => count === 3);
    let approvalRollback: { error: string; atomic: boolean } | { skipped: string };
    if (approvalRequired) {
      const unapproved = await callWrapper(payload, baseline, false, null);
      if (!unapproved.error?.message.includes("MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED")) {
        throw new Error(`APPROVAL_ROLLBACK_NOT_ENFORCED:${unapproved.error?.message ?? "NO_ERROR"}`);
      }
      const afterRejected = { plans: await planState(payload.applyTargetIds), assignments: await assignmentState(payload.applyTargetIds) };
      if (stableJsonDigest(afterRejected) !== beforeRollbackDigest) throw new Error("APPROVAL_REJECTION_NOT_ATOMIC");
      approvalRollback = { error: "MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED", atomic: true };
    } else {
      approvalRollback = { skipped: "NO_CANONICAL_EXACT_THREE_GROUP" };
    }
    const approver = dataset.cleanInput.users.find((user: any) => user.administrator === true || user.preliminarySurveyManager === true);
    if (!approver) throw new Error("LOCAL_AUTHORIZED_APPROVER_REQUIRED");
    const isolatedApproval = approvalRequired ? null : await verifyIsolatedExactThreeApproval(payload, Number(approver.id));
    assertNotInterrupted();
    const approved = await callWrapper(payload, baseline, approvalRequired, approvalRequired ? Number(approver.id) : null);
    if (approved.error) throw new Error(`WRAPPER_APPLY_FAILED:${approved.error.code ?? ""}:${approved.error.message}`);
    assertNotInterrupted();
    const actualPlans = await planState(payload.applyTargetIds);
    const actualPlanComparable = stableRowsForWriteGuard(actualPlans).map((row) => ({
      ...row, measurement_target_business_id: Number(row.measurement_target_business_id),
    }));
    const planMismatches = expectedPlanRows(payload).map((row, index) => ({ expected: row, actual: actualPlanComparable[index] }))
      .filter((item) => replaySourceFingerprint(item.expected) !== replaySourceFingerprint(item.actual));
    const assignmentVerification = await verifyAssignments(payload, approvalRequired ? Number(approver.id) : 0);
    const sourceContextMismatches = await verifySourceContexts(payload);
    if (planMismatches.length || sourceContextMismatches.length || assignmentVerification.mismatches.length || assignmentVerification.scheduleConflicts.length ||
        assignmentVerification.hardMaxGroups) {
      throw new Error(`EXPECTED_ACTUAL_MISMATCH:${JSON.stringify({ planMismatches, sourceContextMismatches,
        assignmentMismatches: assignmentVerification.mismatches,
        scheduleConflicts: assignmentVerification.scheduleConflicts, hardMaxGroups: assignmentVerification.hardMaxGroups })}`);
    }
    const hardAfter = { plans: await planState(hardBlockedTargetIds), assignments: await assignmentState(hardBlockedTargetIds) };
    if (stableJsonDigest(hardAfter) !== stableJsonDigest(hardBefore)) throw new Error("HARD_BLOCK_TARGET_WRITE_DETECTED");
    const protectedAfter = {
      plans: await planState(protectedOrConfirmedIds), assignments: await assignmentState(protectedOrConfirmedIds),
    };
    if (stableJsonDigest(protectedAfter) !== stableJsonDigest(protectedBefore)) throw new Error("PROTECTED_OR_TRUE_CONFIRMED_WRITE_DETECTED");
    const appliedPlanDigest = stableJsonDigest(actualPlans);
    const appliedAssignmentDigest = stableJsonDigest(assignmentVerification.actual);
    const second = await runReplay();
    assertNotInterrupted();
    const secondRunAdditionalChanges = first.comparable.filter((row) => {
      const next = second.comparable.find((item) => item.targetId === row.targetId);
      return !next || !sameReplayResults([row], [next]);
    }).map((row) => row.targetId);
    if (secondRunAdditionalChanges.length) throw new Error(`SECOND_RUN_ADDITIONAL_CHANGES:${secondRunAdditionalChanges.join(",")}`);
    const secondPayload = buildPayload(second);
    if (replaySourceFingerprint(secondPayload) !== replaySourceFingerprint(payload)) {
      throw new Error("SECOND_RUN_FULL_PAYLOAD_CHANGED");
    }
    const secondSourceContextMismatches = await verifySourceContexts(secondPayload);
    const secondPlanComparable = stableRowsForWriteGuard(await planState(secondPayload.applyTargetIds)).map((row) => ({
      ...row, measurement_target_business_id: Number(row.measurement_target_business_id),
    }));
    const secondPlanMismatches = expectedPlanRows(secondPayload).map((row, index) => ({ expected: row, actual: secondPlanComparable[index] }))
      .filter((item) => replaySourceFingerprint(item.expected) !== replaySourceFingerprint(item.actual));
    const secondAssignmentVerification = await verifyAssignments(secondPayload, approvalRequired ? Number(approver.id) : 0);
    if (secondSourceContextMismatches.length || secondPlanMismatches.length || secondAssignmentVerification.mismatches.length) {
      throw new Error(`SECOND_RUN_PERSISTED_CHANGE_SET_NOT_EMPTY:${JSON.stringify({
        sourceContextMismatches: secondSourceContextMismatches,
        planMismatches: secondPlanMismatches,
        assignmentMismatches: secondAssignmentVerification.mismatches,
      })}`);
    }
    const secondPlanDigest = stableJsonDigest(await planState(payload.applyTargetIds));
    const secondAssignmentDigest = stableJsonDigest(await assignmentState(payload.applyTargetIds));
    if (secondPlanDigest !== appliedPlanDigest || secondAssignmentDigest !== appliedAssignmentDigest) {
      throw new Error("SECOND_RUN_UNNECESSARY_WRITE_DETECTED");
    }
    const probeId = await installV1Probe();
    const v1Runs = [];
    for (const value of ["2026-07-01", "2025-01-02", null]) {
      await pg.query("UPDATE public.preliminary_survey_plans SET recommended_date=$1 WHERE id=$2", [value, probeId]);
      v1Runs.push((await runReplay()).comparable);
    }
    await pg.query("DELETE FROM public.preliminary_survey_plans WHERE id=$1", [probeId]);
    const v1Influence = sameReplayResults(v1Runs[0], v1Runs[1]) && sameReplayResults(v1Runs[0], v1Runs[2]) ? 0 : 1;
    if (v1Influence) throw new Error("V1_RECOMMENDED_DATE_INFLUENCE_DETECTED");
    const sourceAfter = await sourceSnapshot();
    if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) throw new Error("SOURCE_TABLE_WRITE_DETECTED");
    const approvalRows = assignmentVerification.expected.filter((row) => row.approval_required);
    const multiDayTargetIds = payload.applyTargetIds.filter((targetId) => {
      const target = first.output.targets.find((row: any) => Number(row.id) === targetId);
      return (target?.measurementAssignmentDates?.length ?? 0) > 1;
    });
    evidence = {
      generatedAt: new Date().toISOString(), mode, environment: "docker-local-supabase",
      inputPath, canonicalPath, sourceGate, prerequisite, initialCounts,
      inventorySummary: dataset.summary,
      replayTargetCount: eligibleIds.length,
      applyTargetCount: payload.applyTargetIds.length,
      applyTargetIds: payload.applyTargetIds,
      hardBlockedTargetIds,
      hardBlocked: canonical.manifest.filter((row: any) => row.hard_blocked).map((row: any) => ({
        targetId: row.target_id, code: row.code, measurementDate: row.measurement_date,
        reason: "MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED", dateCapacity: first.assignments.filter((item) => item.measurementDate === row.measurement_date).length,
      })),
      approvalRequired: approvalRows,
      approvalRequiredCodes: approvalRows.map((row) => canonical.manifest.find((item: any) => item.target_id === row.measurement_target_business_id)?.code),
      authorizedLocalApproverId: approvalRequired ? Number(approver.id) : null,
      approvalRollback,
      isolatedExactThreeApproval: isolatedApproval,
      approvedApply: { rpcBoundary: "persist_preliminary_survey_v2_plan_and_assignment_groups", appliedCount: Array.isArray(approved.data) ? approved.data.length : 0 },
      planCreated: payload.applyTargetIds.length - beforeCandidatePlans.length,
      planUpdated: beforeCandidatePlans.length,
      assignmentRows: assignmentVerification.actual.length,
      expectedActual: { plans: planMismatches.length, sourceContexts: sourceContextMismatches.length,
        assignments: assignmentVerification.mismatches.length, match: true },
      scheduleConflicts: assignmentVerification.scheduleConflicts.length,
      hardMaxGroups: assignmentVerification.hardMaxGroups,
      multiDayTargetIds,
      multiDayPartialAssignments: 0,
      secondRunAdditionalChanges: 0,
      secondRunFullPayloadChanges: 0,
      secondRunPersistedFieldChanges: 0,
      secondApplySkipped: true,
      secondRunDigestsUnchanged: true,
      protectedOrTrueConfirmedChanges: 0,
      hardBlockedTargetChanges: 0,
      sourceTableChanges: 0,
      v1ResidualNonNull: dataset.inventory.filter((row: any) => row.ignored_v1_preliminary_date != null).length,
      v1Influence,
      productionWrite: 0,
      canonicalReplayDigest: canonicalDigest,
      actualPlanDigest: appliedPlanDigest,
      actualAssignmentDigest: appliedAssignmentDigest,
    };
  } finally {
    await cleanupLocal();
    finalCounts = await assertEmptyLocal();
    await pg.end();
  }
  evidence.finalCounts = finalCounts;
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, replayTargetCount: evidence.replayTargetCount,
    applyTargetCount: evidence.applyTargetCount, hardBlocked: evidence.hardBlocked,
    approvalRequiredCodes: evidence.approvalRequiredCodes, assignmentRows: evidence.assignmentRows,
    checks: { stale: evidence.sourceGate.staleTargetIds.length, expectedActual: evidence.expectedActual.match,
      secondRunAdditionalChanges: evidence.secondRunAdditionalChanges, v1Influence: evidence.v1Influence,
      protectedOrTrueConfirmedChanges: evidence.protectedOrTrueConfirmedChanges, productionWrite: evidence.productionWrite },
    finalCounts }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
