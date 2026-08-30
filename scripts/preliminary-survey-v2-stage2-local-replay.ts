import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { calculateV2Recommendations } from "../lib/preliminary-survey-v2/service";
import {
  assignMeasurementAssignees,
  buildMeasurementAssignmentTargets,
  type MeasurementAssignmentResult,
} from "../lib/preliminary-survey-v2/measurement-assignment";
import {
  assertPreliminarySurveyV2CleanInput,
  canonicalReplayResults,
  measurementAssignmentBlockedKeys,
  replayChangeType,
  replaySourceFingerprint,
  sameReplayResults,
  type ReplayComparableResult,
} from "../lib/preliminary-survey-v2/historical-replay";
import { allOrNothingAssignments } from "../lib/preliminary-survey-v2/stage2-rehearsal";

const inputPath = resolve(process.argv.find((value) => value.startsWith("--input="))?.slice(8) ||
  "C:/Users/USER/Downloads/2026-08-23_stage2-1-production-inventory.json");
const outputPath = resolve(process.argv.find((value) => value.startsWith("--output="))?.slice(9) ||
  "C:/Users/USER/Downloads/2026-08-23_stage2-1-replay-manifest.json");
const canonicalOnly = process.argv.includes("--canonical-only");
const localDbUrl = process.env.STAGE2_LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const localApiUrl = process.env.STAGE2_LOCAL_API_URL || "http://127.0.0.1:54321";
const localServiceKey = process.env.STAGE2_LOCAL_SERVICE_ROLE_KEY;
if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\//.test(localDbUrl) || !/^http:\/\/127\.0\.0\.1:54321$/.test(localApiUrl)) {
  throw new Error("ISOLATED_LOCAL_SUPABASE_REQUIRED");
}
if (!localServiceKey) throw new Error("STAGE2_LOCAL_SERVICE_ROLE_KEY_REQUIRED");

export const dataset = JSON.parse(readFileSync(inputPath, "utf8"));
assertPreliminarySurveyV2CleanInput(dataset.cleanInput);
export const cleanInput = dataset.cleanInput;
const persistenceSourceContextById = new Map((dataset.diagnosticSource?.persistenceSourceContexts ?? [])
  .map((row: any) => [Number(row.id), row]));
export const pg = new Client({ connectionString: localDbUrl });
export const supabase = createClient(localApiUrl, localServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
export const eligibleIds = dataset.inventory.filter((row: any) => row.replay_eligible).map((row: any) => Number(row.target_id));
export const inventoryById = new Map(dataset.inventory.map((row: any) => [Number(row.target_id), row]));

export async function assertEmptyLocal() {
  const result = await pg.query(`SELECT json_build_object(
    'targets', (SELECT count(*) FROM public.measurement_target_business),
    'users', (SELECT count(*) FROM public.users),
    'plans', (SELECT count(*) FROM public.preliminary_survey_v2_plans),
    'assignments', (SELECT count(*) FROM public.preliminary_survey_v2_measurement_assignments),
    'v1_plans', (SELECT count(*) FROM public.preliminary_survey_plans),
    'journals', (SELECT count(*) FROM public.measurement_journal),
    'blocks', (SELECT count(*) FROM public.user_schedule_blocks),
    'business_info', (SELECT count(*) FROM public.business_info),
    'policy_settings', (SELECT count(*) FROM public.preliminary_survey_policy_settings)
  ) AS counts`);
  const counts = result.rows[0].counts;
  if (Object.values(counts).some((value) => Number(value) !== 0)) throw new Error(`LOCAL_NOT_EMPTY:${JSON.stringify(counts)}`);
  return counts;
}

export async function seedLocal() {
  await pg.query("BEGIN");
  try {
    await pg.query("SET LOCAL session_replication_role = replica");
    for (const user of cleanInput.users) {
      await pg.query(`INSERT INTO public.users
        (id,name,role,job,survey_code,is_active,is_preliminary_survey_experienced,
         is_preliminary_survey_support_assignable,is_preliminary_survey_manager,is_designated_office_report_manager)
        VALUES ($1,$2,$3,'측정',$4,$5,$6,$7,$8,false)`, [
        user.id, user.name, user.administrator ? "관리자" : "사용자", user.surveyCode, user.active,
        user.preliminarySurveyExperienced, user.preliminarySurveySupportAssignable, user.preliminarySurveyManager,
      ]);
    }
    for (const target of cleanInput.targets) {
      const context: any = persistenceSourceContextById.get(Number(target.id)) ?? {};
      await pg.query(`INSERT INTO public.measurement_target_business
        (id,year,period,code,business_name,address,measurement_date,measurement_end_date,measurer_id,
         link_measurer_id,collaborators,daily_staff,created_at,updated_at,business_type,process_changed,
         preliminary_survey_rule_type,requires_field_preliminary_survey)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$12,$13,$14,$15,$16)`, [
        target.id, target.year, target.period, target.code, target.businessName, target.address,
        target.measurementDate, target.measurementEndDate, context.measurer_id ?? null, context.collaborators ?? null,
        context.daily_staff == null ? null : JSON.stringify(context.daily_staff),
        target.createdAt, target.businessType, target.processChanged, target.preliminarySurveyRuleType,
        target.requiresFieldPreliminarySurvey,
      ]);
    }
    for (const info of cleanInput.targets) {
      if (info.latitude == null || info.longitude == null) continue;
      await pg.query(`INSERT INTO public.business_info (code,business_name,latitude,longitude)
        VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
      [info.code, info.businessName, info.latitude, info.longitude]);
    }
    for (const journal of cleanInput.journals) {
      await pg.query(`INSERT INTO public.measurement_journal
        (id,code,measurement_year,measurement_period,note,business_name,designated_office,completion_status,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$2,'CLEAN_INPUT','미완료',$6,$7)`, [
        journal.id, journal.code, journal.measurementYear, journal.measurementPeriod, journal.note,
        journal.createdAt, journal.updatedAt,
      ]);
    }
    for (const block of cleanInput.scheduleBlocks) {
      await pg.query(`INSERT INTO public.user_schedule_blocks
        (id,user_id,start_date,end_date,block_type)
        VALUES ($1,$2,$3,$4,$5)`, [block.id, block.userId, block.startDate, block.endDate, block.blockType]);
    }
    for (const policy of cleanInput.policySettings) {
      await pg.query(`INSERT INTO public.preliminary_survey_policy_settings
        (policy_key,enabled,effective_start_year,effective_start_period,effective_start_measurement_date)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (policy_key) DO UPDATE SET enabled=EXCLUDED.enabled,
          effective_start_year=EXCLUDED.effective_start_year,effective_start_period=EXCLUDED.effective_start_period,
          effective_start_measurement_date=EXCLUDED.effective_start_measurement_date`, [policy.policyKey, policy.enabled,
        policy.effectiveStartYear, policy.effectiveStartPeriod, policy.effectiveStartMeasurementDate]);
    }
    await pg.query("COMMIT");
  } catch (error) {
    await pg.query("ROLLBACK");
    throw error;
  }
}

async function loadMeasurementAssignmentBlockedKeys(measurementDates: string[]) {
  const dates = [...new Set(measurementDates)].sort();
  if (!dates.length) return new Set<string>();
  const { data, error } = await supabase.from("user_schedule_blocks")
    .select("user_id,start_date,end_date")
    .lte("start_date", dates.at(-1)!)
    .gte("end_date", dates[0]);
  if (error) throw new Error(`MEASUREMENT_SCHEDULE_BLOCKS:${error.code ?? ""}:${error.message}`);
  return measurementAssignmentBlockedKeys(data ?? [], dates);
}

export async function runReplay(): Promise<{ comparable: ReplayComparableResult[]; output: any; assignments: MeasurementAssignmentResult[]; hardBlockedTargetIds: Set<number>; measurementScheduleBlockAffectedTargetIds: Set<number>; measurementScheduleConflictTargetIds: Set<number> }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.baselineDate ?? "")) throw new Error("CLEAN_BASELINE_DATE_REQUIRED");
  const output = await calculateV2Recommendations(supabase as any, {
    targetIds: eligibleIds, planningDate: dataset.baselineDate, allowExternalRoutes: false,
    ignoreLegacyAssignmentInputs: true,
  });
  const targetById = new Map(output.targets.map((target: any) => [target.id, target]));
  const resultById = new Map(output.results.map((result: any) => [result.targetId, result]));
  const assignmentTargets = output.results.flatMap((result: any) => {
    const target: any = targetById.get(result.targetId);
    if (!target || result.status !== "recommended") return [];
    return buildMeasurementAssignmentTargets({ target, preliminarySurveyorUserIds: result.participants.map((user) => user.id) });
  });
  const users = cleanInput.users.map((user: any) => ({
    id: Number(user.id), name: user.name, surveyCode: user.surveyCode, active: user.active,
  }));
  const measurementScheduleBlockedKeys = await loadMeasurementAssignmentBlockedKeys(
    assignmentTargets.map((target) => target.measurementDate),
  );
  // 기존 actual measurement conflict hard constraint는 보존하고, 측정일 schedule block을 명시적으로 합친다.
  const blockedKeys = new Set<string>([...output.blockedKeys, ...measurementScheduleBlockedKeys]);
  const measurementCandidateUserIds = new Set(users.filter((user: any) => user.active !== false &&
    ["A", "B", "C", "D", "F", "G"].includes(user.surveyCode)).map((user: any) => Number(user.id)));
  const measurementScheduleBlockAffectedTargetIds = new Set(assignmentTargets.filter((target) =>
    [...measurementCandidateUserIds].some((userId) => measurementScheduleBlockedKeys.has(`${userId}:${target.measurementDate}`)),
  ).map((target) => target.targetId));
  const measurementScheduleConflictTargetIds = new Set<number>();
  assignmentTargets.forEach((target) => {
    const roleUserIds = [target.reportWriterUserId, ...(target.measurementParticipantUserIds ?? [])]
      .filter((id): id is number => id != null);
    if (roleUserIds.some((userId) => measurementScheduleBlockedKeys.has(`${userId}:${target.measurementDate}`))) {
      measurementScheduleConflictTargetIds.add(target.targetId);
    }
  });
  const assignments: MeasurementAssignmentResult[] = [];
  const hardBlockedTargetIds = new Set<number>();
  for (const measurementDate of [...new Set(assignmentTargets.map((target) => target.measurementDate))].sort()) {
    const dateTargets = assignmentTargets.filter((target) => target.measurementDate === measurementDate)
      .sort((left, right) => left.targetId - right.targetId);
    const availableUserCount = users.filter((user: any) => user.active !== false &&
      ["A", "B", "C", "D", "F", "G"].includes(user.surveyCode) &&
      !blockedKeys.has(`${user.id}:${measurementDate}`)).length;
    const automaticCapacity = availableUserCount * 3;
    dateTargets.slice(automaticCapacity).forEach((target) => hardBlockedTargetIds.add(target.targetId));
    assignments.push(...assignMeasurementAssignees({
      targets: dateTargets.slice(0, automaticCapacity), users,
      availability: { isBlocked: (userId, date) => blockedKeys.has(`${userId}:${date}`) },
    }));
  }
  // 다일 target의 어느 한 날짜라도 hard-block이면 그 target의 모든 날짜를 제외한다.
  const completeAssignments = allOrNothingAssignments(assignments, hardBlockedTargetIds);
  const comparable = eligibleIds.map((targetId: number) => {
    const result: any = resultById.get(targetId);
    return {
      targetId,
      replayDate: result?.date ?? null,
      responsibleUserId: result?.responsible?.id ?? null,
      reviewerUserId: result?.experiencedReviewer?.id ?? null,
      participantUserIds: result?.participants?.map((user: any) => Number(user.id)) ?? [],
      measurementAssignments: completeAssignments.filter((item) => item.targetId === targetId).map((item) => ({
        measurementDate: item.measurementDate, assigneeUserId: item.userId,
        surveyCode: item.publicSampleCode, approvalRequired: item.approvalRequired,
      })),
      warning: [
        ...(result?.evidence?.warnings ?? []),
        ...(measurementScheduleConflictTargetIds.has(targetId) ? ["MEASUREMENT_SOURCE_SCHEDULE_CONFLICT_REVIEW_REQUIRED"] : []),
      ],
      status: hardBlockedTargetIds.has(targetId) ? "hard_blocked" : result?.status ?? "source_incomplete",
    } satisfies ReplayComparableResult;
  });
  return { comparable, output, assignments: completeAssignments, hardBlockedTargetIds, measurementScheduleBlockAffectedTargetIds,
    measurementScheduleConflictTargetIds };
}

async function applyReplayLocally(replay: Awaited<ReturnType<typeof runReplay>>) {
  const targetById = new Map(replay.output.targets.map((target: any) => [target.id, target]));
  await pg.query("BEGIN");
  try {
    for (const result of replay.output.results) {
      if (replay.hardBlockedTargetIds.has(result.targetId)) continue;
      const target: any = targetById.get(result.targetId);
      if (!target) continue;
      await pg.query(`INSERT INTO public.preliminary_survey_v2_plans
        (measurement_target_business_id,recommended_date,responsible_user_id,experienced_reviewer_id,
         participant_user_ids,participant_names,status,plan_origin,source_measurement_date,source_responsible_user_id,
         source_rule_type,survey_method,recommendation_reason,route_evidence,warnings)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (measurement_target_business_id) DO UPDATE SET
          recommended_date=EXCLUDED.recommended_date,responsible_user_id=EXCLUDED.responsible_user_id,
          experienced_reviewer_id=EXCLUDED.experienced_reviewer_id,participant_user_ids=EXCLUDED.participant_user_ids,
          participant_names=EXCLUDED.participant_names,status=EXCLUDED.status,plan_origin=EXCLUDED.plan_origin,
          source_measurement_date=EXCLUDED.source_measurement_date,
          source_responsible_user_id=EXCLUDED.source_responsible_user_id,source_rule_type=EXCLUDED.source_rule_type,
          survey_method=EXCLUDED.survey_method,recommendation_reason=EXCLUDED.recommendation_reason,
          route_evidence=EXCLUDED.route_evidence,warnings=EXCLUDED.warnings`, [
        result.targetId, result.date, result.responsible.id, result.experiencedReviewer?.id ?? null,
        JSON.stringify(result.participants.map((user: any) => user.id)),
        JSON.stringify(result.participants.map((user: any) => user.name)), result.status,
        result.evidence.warnings.includes("MINIMUM_CHANGE_PRESERVED") ? "manual" : "automatic",
        target.measurementDate, target.sourceMeasurerId, target.kind, result.surveyMethod,
        JSON.stringify({ reason: result.reason, evidence: result.evidence }), JSON.stringify({}),
        JSON.stringify(result.evidence.warnings),
      ]);
    }
    await pg.query(`DELETE FROM public.preliminary_survey_v2_measurement_assignments a USING public.preliminary_survey_v2_plans p
      WHERE a.plan_id=p.id AND p.measurement_target_business_id = ANY($1::bigint[])`, [eligibleIds]);
    for (const assignment of replay.assignments) {
      const plan = await pg.query("SELECT id FROM public.preliminary_survey_v2_plans WHERE measurement_target_business_id=$1", [assignment.targetId]);
      const approvalAt = assignment.approvalRequired ? new Date("2026-08-23T00:00:00+09:00") : null;
      await pg.query(`INSERT INTO public.preliminary_survey_v2_measurement_assignments
        (plan_id,measurement_date,assignee_user_id,survey_code,assignment_reason,approval_required,
         approved_by_user_id,approved_at,approval_group_fingerprint)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`, [plan.rows[0].id, assignment.measurementDate,
        assignment.userId, assignment.publicSampleCode, assignment.reason, assignment.approvalRequired,
        assignment.approvalRequired ? assignment.userId : null, approvalAt]);
    }
    await pg.query("COMMIT");
  } catch (error) {
    await pg.query("ROLLBACK");
    throw error;
  }
}

export async function installV1Probe() {
  const v1Plans = dataset.diagnosticSource?.v1Plans ?? [];
  const target = dataset.inventory.find((row: any) => row.replay_eligible &&
    !v1Plans.some((plan: any) => Number(plan.measurement_target_business_id) === Number(row.target_id)));
  const template = v1Plans[0];
  if (!target || !template) throw new Error("V1_PROBE_SOURCE_MISSING");
  const probe = { ...template, id: "00000000-0000-4000-8000-000000000021",
    measurement_target_business_id: Number(target.target_id), status: "cancelled", recommended_date: "2026-07-01",
    confirmed_date: null, confirmed_by: null, confirmed_at: null, row_version: 1 };
  await pg.query(`INSERT INTO public.preliminary_survey_plans
    SELECT * FROM json_populate_record(NULL::public.preliminary_survey_plans, $1::json)`, [JSON.stringify(probe)]);
  return probe.id;
}

async function existingV2InfluenceProbe() {
  const targetId = eligibleIds[0];
  const target: any = cleanInput.targets.find((row: any) => Number(row.id) === Number(targetId));
  const user: any = cleanInput.users.find((row: any) => row.active !== false);
  if (!target || !user) throw new Error("V2_PROBE_SOURCE_MISSING");
  const result = await pg.query(`INSERT INTO public.preliminary_survey_v2_plans
    (measurement_target_business_id,recommended_date,responsible_user_id,participant_user_ids,participant_names,
     status,plan_origin,source_measurement_date,source_responsible_user_id,source_rule_type,survey_method,
     recommendation_reason,route_evidence,warnings)
    VALUES ($1,'2026-08-01',$2,$3,$4,'recommended','manual',$5,$2,'existing','phone','{}','{}','[]')
    RETURNING id`, [targetId, user.id, JSON.stringify([user.id]), JSON.stringify([user.name]), target.measurementDate]);
  const replay = (await runReplay()).comparable;
  await pg.query("DELETE FROM public.preliminary_survey_v2_plans WHERE id=$1", [result.rows[0].id]);
  return replay;
}

export async function cleanupLocal() {
  await pg.query("BEGIN");
  try {
    await pg.query("SET LOCAL session_replication_role = replica");
    await pg.query("DELETE FROM public.preliminary_survey_v2_measurement_assignments");
    await pg.query("DELETE FROM public.preliminary_survey_plans");
    await pg.query("DELETE FROM public.measurement_journal");
    await pg.query("DELETE FROM public.preliminary_survey_v2_plans");
    await pg.query("DELETE FROM public.user_schedule_blocks");
    await pg.query("DELETE FROM public.preliminary_survey_policy_settings");
    await pg.query("DELETE FROM public.business_info");
    await pg.query("DELETE FROM public.measurement_target_business");
    await pg.query("DELETE FROM public.users");
    await pg.query("COMMIT");
  } catch (error) { await pg.query("ROLLBACK"); throw error; }
}

async function main() {
  await pg.connect();
  const initial = await assertEmptyLocal();
  try {
    await seedLocal();
    const first = await runReplay();
    const independent = await runReplay();
    const existingV2Probe = await existingV2InfluenceProbe();
    if (!canonicalOnly) await applyReplayLocally(first);
    const second = canonicalOnly ? first : await runReplay();
    const probeId = await installV1Probe();
    const v1Results: ReplayComparableResult[][] = [];
    for (const date of ["2026-07-01", "2025-01-02", null]) {
      await pg.query("UPDATE public.preliminary_survey_plans SET recommended_date=$1 WHERE id=$2", [date, probeId]);
      v1Results.push((await runReplay()).comparable);
    }
    const resultById = new Map(first.comparable.map((row) => [row.targetId, row]));
    const replayManifest = dataset.inventory.map((current: any) => {
      const replay = resultById.get(Number(current.target_id));
      const excluded = current.true_confirmed ? "true_confirmed" : current.protected ? "protected"
        : current.past_due_unmeasured ? "past_due"
        : !current.source_complete ? "source_incomplete" : replay?.status === "hard_blocked" ? "hard_blocked"
        : replay?.status === "manual_required" ? "manual_required" : undefined;
      const currentAssignmentIds = current.current_measurement_assignee.map((item: any) => item.user_id).filter((id: any) => id != null);
      const replayAssignmentIds = replay?.measurementAssignments.map((item) => item.assigneeUserId) ?? [];
      const assignmentChanged = JSON.stringify(currentAssignmentIds) !== JSON.stringify(replayAssignmentIds);
      const sourceResult: any = first.output.results.find((item: any) => item.targetId === current.target_id);
      return {
        target_id: current.target_id, code: current.code, measurement_date: current.measurement_date,
        source_fingerprint: current.source_fingerprint,
        true_confirmed: current.true_confirmed,
        protected: current.protected,
        hard_blocked: replay?.status === "hard_blocked",
        current_v2_date: current.current_v2_preliminary_date, replay_date: replay?.replayDate ?? null,
        current_responsible: current.current_v2_responsible, replay_responsible: replay?.responsibleUserId ?? null,
        current_reviewer: current.current_v2_reviewer, replay_reviewer: replay?.reviewerUserId ?? null,
        replay_participants: replay?.participantUserIds ?? [],
        current_measurement_assignee: current.current_measurement_assignee,
        replay_measurement_assignee: replay?.measurementAssignments ?? [],
        survey_method: sourceResult?.surveyMethod ?? null,
        approval_required: replay?.measurementAssignments.some((item) => item.approvalRequired) ?? false,
        warning: replay?.warning ?? [],
        change_type: replayChangeType({ excluded, manualPreserved: replay?.warning.includes("MINIMUM_CHANGE_PRESERVED"),
          currentDate: current.current_v2_preliminary_date, replayDate: replay?.replayDate ?? null,
          currentResponsibleUserId: current.current_v2_responsible, replayResponsibleUserId: replay?.responsibleUserId ?? null,
          measurementAssigneeChanged: assignmentChanged }),
        exclusion_reason: current.exclusion_reason,
      };
    });
    const changeCounts = Object.fromEntries([...new Set(replayManifest.map((row: any) => row.change_type))]
      .sort().map((type) => [type, replayManifest.filter((row: any) => row.change_type === type).length]));
    const secondById = new Map(second.comparable.map((row) => [row.targetId, row]));
    const secondRunChangedTargetIds = first.comparable.filter((row) =>
      !sameReplayResults([row], secondById.has(row.targetId) ? [secondById.get(row.targetId)!] : []),
    ).map((row) => row.targetId);
    const secondRunDiffs = secondRunChangedTargetIds.map((targetId) => ({
      targetId, first: first.comparable.find((row) => row.targetId === targetId), second: secondById.get(targetId),
    }));
    const payload = {
      generatedAt: new Date().toISOString(), environment: "docker-local-supabase",
      mode: canonicalOnly ? "canonical-only" : "local-replay",
      inputPath, inputSha256: createHash("sha256").update(readFileSync(inputPath)).digest("hex"),
      localInitialCounts: initial, replayTargetCount: eligibleIds.length,
      firstReplay: canonicalReplayResults(first.comparable), manifest: replayManifest, changeCounts,
      checks: {
        planningDate: dataset.baselineDate,
        todayCutoffApplied: true,
        staleTargets: 0,
        sourceIncomplete: dataset.inventory.filter((row: any) => !row.source_complete).length,
        deterministic: sameReplayResults(first.comparable, independent.comparable),
        secondRunAdditionalChanges: secondRunChangedTargetIds.length,
        secondRunChangedTargetIds,
        secondRunDiffs,
        v1Influence: sameReplayResults(v1Results[0], v1Results[1]) && sameReplayResults(v1Results[0], v1Results[2]) ? 0 : 1,
        existingV2Influence: sameReplayResults(first.comparable, existingV2Probe) ? 0 : 1,
        trueConfirmedProposals: replayManifest.filter((row: any) => row.change_type === "true_confirmed_excluded" && row.replay_date != null).length,
        protectedProposals: replayManifest.filter((row: any) => row.change_type === "protected_excluded" && row.replay_date != null).length,
        approvalRequired: first.assignments.filter((row) => row.approvalRequired).length,
        hardBlocked: replayManifest.filter((row: any) => row.change_type === "hard_blocked").length,
        manualRequired: first.comparable.filter((row) => row.status === "manual_required").length,
        measurementScheduleBlockAffectedTargets: first.measurementScheduleBlockAffectedTargetIds.size,
        measurementSourceScheduleConflicts: first.measurementScheduleConflictTargetIds.size,
      },
      replayDigest: replaySourceFingerprint(canonicalReplayResults(first.comparable)),
    };
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ outputPath, replayTargetCount: eligibleIds.length, changeCounts,
      checks: payload.checks, replayDigest: payload.replayDigest }, null, 2));
  } finally {
    await cleanupLocal();
    await assertEmptyLocal();
    await pg.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
