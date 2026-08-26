import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import { buildHistoricalPlanRecoveryManifest } from "../lib/preliminary-survey-v2/historical-plan-recovery";
import { actualMeasurementBlockedKeys } from "../lib/preliminary-survey-v2/measurement-conflicts";

const envPath = process.argv.find((value) => value.startsWith("--env="))?.slice(6) ?? ".env.local";
config({ path: envPath });
const localUrl = process.env.HISTORY_RECOVERY_LOCAL_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/^postgres(?:ql)?:\/\/(?:postgres(?::[^@]*)?@)?(?:127\.0\.0\.1|localhost):54322\//i.test(localUrl)) {
  throw new Error("PRODUCTION_WRITE_FORBIDDEN_IN_HISTORY_REHEARSAL");
}
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!apiUrl || !serviceKey) throw new Error("PRODUCTION_READ_ENV_REQUIRED");
const production = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const local = new Client({ connectionString: localUrl });
let cancelled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { cancelled = true; });
const checkpoint = () => { if (cancelled) throw new Error("HISTORY_REHEARSAL_CANCELLED"); };
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
const dateOnly = (value: unknown) => value instanceof Date ? dateFormatter.format(value) : String(value ?? "");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function allRows(table: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await production.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table}:${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

async function insertRows(table: string, rows: any[]) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const quoted = columns.map((column) => `"${column}"`).join(",");
  for (const row of rows) {
    checkpoint();
    const values = columns.map((column) => {
      const value = row[column] ?? null;
      return value != null && typeof value === "object" ? JSON.stringify(value) : value;
    });
    await local.query(`insert into public.${table} (${quoted}) values (${columns.map((_, index) => `$${index + 1}`).join(",")})`, values);
  }
}

async function localCounts() {
  return (await local.query(`select
    (select count(*) from public.users)::integer users,
    (select count(*) from public.measurement_target_business)::integer targets,
    (select count(*) from public.preliminary_survey)::integer legacy,
    (select count(*) from public.preliminary_survey_v2_plans)::integer plans,
    (select count(*) from public.preliminary_survey_v2_measurement_assignments)::integer assignments,
    (select count(*) from public.measurement_journal)::integer journals,
    (select count(*) from public.user_schedule_blocks)::integer blocks,
    (select count(*) from public.preliminary_survey_v2_history_recovery_batches)::integer batches,
    (select count(*) from public.preliminary_survey_v2_history_recovery_audit)::integer audit`)).rows[0];
}

async function main() {
  checkpoint();
  const [users, targets, legacy, plans, assignments, journals, blocks, policy, businessInfo] = await Promise.all([
    allRows("users"), allRows("measurement_target_business"), allRows("preliminary_survey"),
    allRows("preliminary_survey_v2_plans"), allRows("preliminary_survey_v2_measurement_assignments"),
    allRows("measurement_journal"), allRows("user_schedule_blocks"),
    allRows("preliminary_survey_policy_settings"), allRows("business_info"),
  ]);
  await local.connect();
  try {
    const initial = await localCounts();
    if (Object.values(initial).some((value) => Number(value) !== 0)) throw new Error(`LOCAL_FIXTURE_NOT_EMPTY:${JSON.stringify(initial)}`);
    await local.query("begin");
    await insertRows("users", users);
    await insertRows("measurement_target_business", targets);
    await insertRows("preliminary_survey", legacy);
    await insertRows("preliminary_survey_v2_plans", plans);
    await insertRows("preliminary_survey_v2_measurement_assignments", assignments);
    await insertRows("business_info", businessInfo);
    await insertRows("measurement_journal", journals);
    await insertRows("user_schedule_blocks", blocks);
    await insertRows("preliminary_survey_policy_settings", policy);
    await local.query("commit");
    checkpoint();

    const scopeTargets = (await local.query(`select id,code,year,period,measurement_date,business_type,
      preliminary_survey_rule_type,process_changed from public.measurement_target_business
      where year=2026 and measurement_date between '2026-08-01' and '2026-08-26' order by measurement_date,id`)).rows
      .map((row) => ({ ...row, id: Number(row.id), year: Number(row.year), measurement_date: dateOnly(row.measurement_date) }));
    const scopeLegacy = (await local.query(`select id,code,year,period,measurement_date,preliminary_surveyor
      from public.preliminary_survey where year=2026 and measurement_date between date '2026-08-01' and date '2026-08-26' order by id`)).rows
      .map((row) => ({ ...row, id: Number(row.id), year: Number(row.year), measurement_date: dateOnly(row.measurement_date) }));
    const localUsers = (await local.query(`select id,name,is_active,is_preliminary_survey_experienced,
      is_preliminary_survey_support_assignable from public.users order by id`)).rows
      .map((row) => ({ ...row, id: Number(row.id) }));
    const localPlans = (await local.query(`select id,measurement_target_business_id,recommended_date,responsible_user_id,
      survey_method,status from public.preliminary_survey_v2_plans order by measurement_target_business_id`)).rows
      .map((row) => ({ ...row, measurement_target_business_id: Number(row.measurement_target_business_id),
        responsible_user_id: Number(row.responsible_user_id), recommended_date: row.recommended_date == null ? null : dateOnly(row.recommended_date) }));
    const candidateDates = [...new Set(scopeTargets.flatMap((target) =>
      recommendationDatesForBusinessType(target.measurement_date, "existing").map((candidate) => candidate.date)))];
    const localBlocks = (await local.query("select user_id,start_date,end_date from public.user_schedule_blocks")).rows;
    const scheduleBlockedKeys = new Set<string>();
    for (const block of localBlocks) for (const date of candidateDates) {
      if (dateOnly(block.start_date) <= date && dateOnly(block.end_date) >= date) scheduleBlockedKeys.add(`${block.user_id}:${date}`);
    }
    const measurementTargets = (await local.query("select measurement_date,measurement_end_date,daily_staff,collaborators from public.measurement_target_business where year in (2025,2026)")).rows
      .map((row) => ({ ...row, measurement_date: dateOnly(row.measurement_date), measurement_end_date: row.measurement_end_date == null ? null : dateOnly(row.measurement_end_date) }));
    const legacySchedules = (await local.query("select measurement_date,actual_measurer from public.preliminary_survey where measurement_date = any($1::date[])", [candidateDates])).rows
      .map((row) => ({ ...row, measurement_date: dateOnly(row.measurement_date) }));
    const measurementBlockedKeys = actualMeasurementBlockedKeys({ dates: candidateDates, users: localUsers, targets: measurementTargets, legacySchedules });
    const sourceHashRows = (await local.query(`select id,public.preliminary_survey_v2_history_source_hash(id) source_hash
      from public.preliminary_survey where year=2026 and measurement_date between date '2026-08-01' and date '2026-08-26' order by id`)).rows;
    const targetHashRows = (await local.query(`select id,public.preliminary_survey_v2_history_target_hash(id) target_hash
      from public.measurement_target_business where year=2026 and measurement_date between '2026-08-01' and '2026-08-26' order by id`)).rows;
    const contextHash = String((await local.query("select public.preliminary_survey_v2_history_context_hash() value")).rows[0].value);
    const manifest = buildHistoricalPlanRecoveryManifest({
      targets: scopeTargets, legacySources: scopeLegacy, users: localUsers, existingPlans: localPlans,
      scheduleBlockedKeys, measurementBlockedKeys,
      sourceHashes: new Map(sourceHashRows.map((row) => [Number(row.id), String(row.source_hash)])),
      targetHashes: new Map(targetHashRows.map((row) => [Number(row.id), String(row.target_hash)])), contextHash,
    });
    const manifestSha = String((await local.query("select public.preliminary_survey_v2_history_manifest_sha($1::jsonb) value", [JSON.stringify(manifest)])).rows[0].value);
    const counts = Object.fromEntries([...new Set(manifest.map((row) => row.classification))].sort()
      .map((classification) => [classification, manifest.filter((row) => row.classification === classification).length]));
    const recoverable = manifest.filter((row) => row.classification === "HISTORICAL_EXACT_RECOVERY").length;
    if (manifest.length !== 88 || Number(counts.EXISTING_V2_PRESERVED ?? 0) !== 42) {
      throw new Error(`LOCAL_CANONICAL_COUNT_MISMATCH:${JSON.stringify(counts)}`);
    }

    const existingPlanRowsBefore = (await local.query("select * from public.preliminary_survey_v2_plans order by id")).rows;
    const assignmentsBefore = (await local.query("select * from public.preliminary_survey_v2_measurement_assignments order by id")).rows;
    const legacyBefore = (await local.query("select * from public.preliminary_survey order by id")).rows;
    const targetsBefore = (await local.query("select * from public.measurement_target_business order by id")).rows;
    const journalsBefore = (await local.query("select * from public.measurement_journal order by id")).rows;
    const trueConfirmedGuardBlocked = Boolean((await local.query(`select exists(
      select 1 from pg_trigger where tgrelid='public.preliminary_survey_v2_plans'::regclass
        and tgname='trg_guard_true_confirmed_preliminary_survey_v2_plan' and tgenabled='O'
    ) enabled`)).rows[0].enabled);
    if (!trueConfirmedGuardBlocked) throw new Error("TRUE_CONFIRMED_GENERAL_GUARD_NOT_ENABLED");
    const batchId = randomUUID();
    await local.query("begin");
    await local.query("set local role service_role");
    const first = (await local.query("select public.recover_preliminary_survey_v2_historical_plans($1,$2::jsonb,$3,$4,$5,$6) value",
      [batchId, JSON.stringify(manifest), manifestSha, contextHash, manifest.length, recoverable])).rows[0].value;
    await local.query("commit");
    checkpoint();
    const insertedRows = (await local.query("select * from public.preliminary_survey_v2_plans where recommendation_reason->>'batchId'=$1 order by measurement_target_business_id", [batchId])).rows;
    if (insertedRows.length !== recoverable) throw new Error("LOCAL_EXPECTED_ACTUAL_PLAN_MISMATCH");
    const insertedByTarget = new Map(insertedRows.map((row) => [Number(row.measurement_target_business_id), row]));
    const planMismatches = manifest.filter((row) => row.classification === "HISTORICAL_EXACT_RECOVERY").filter((expected) => {
      const actual = insertedByTarget.get(expected.targetId);
      return !actual || dateOnly(actual.recommended_date) !== expected.derivedPreliminaryDate
        || Number(actual.responsible_user_id) !== expected.derivedResponsibleUserId
        || (actual.experienced_reviewer_id == null ? null : Number(actual.experienced_reviewer_id)) !== expected.derivedReviewerUserId
        || JSON.stringify(actual.participant_user_ids) !== JSON.stringify(expected.participantUserIds)
        || JSON.stringify(actual.participant_names) !== JSON.stringify(expected.participantNames)
        || actual.status !== "recommended" || actual.plan_origin !== "manual" || actual.survey_method !== "phone"
        || actual.source_rule_type !== "existing" || dateOnly(actual.source_measurement_date) !== expected.measurementDate
        || Number(actual.source_responsible_user_id) !== expected.derivedResponsibleUserId
        || actual.recommendation_reason?.reason !== "HISTORICAL_REPLAY_2026_08_26"
        || actual.recommendation_reason?.surveyorSource !== "legacy_preliminary_survey"
        || actual.recommendation_reason?.batchId !== batchId;
    });
    if (planMismatches.length) throw new Error(`LOCAL_PLAN_FIELD_MISMATCH:${planMismatches.map((row) => row.code).join(",")}`);
    const protectedWrites = manifest.filter((row) => row.classification === "PROTECTED_PRESERVED")
      .filter((row) => insertedByTarget.has(row.targetId));
    if (protectedWrites.length) throw new Error("PROTECTED_PLAN_WRITTEN");
    const existingAfterApply = (await local.query("select * from public.preliminary_survey_v2_plans where recommendation_reason->>'batchId' is distinct from $1 order by id", [batchId])).rows;
    if (digest(existingPlanRowsBefore) !== digest(existingAfterApply)) throw new Error("EXISTING_V2_PLAN_CHANGED");

    const persistedDigestBeforeSecond = digest(insertedRows);
    await local.query("begin");
    await local.query("set local role service_role");
    const second = (await local.query("select public.recover_preliminary_survey_v2_historical_plans($1,$2::jsonb,$3,$4,$5,$6) value",
      [batchId, JSON.stringify(manifest), manifestSha, contextHash, manifest.length, recoverable])).rows[0].value;
    await local.query("commit");
    const insertedAfterSecond = (await local.query("select * from public.preliminary_survey_v2_plans where recommendation_reason->>'batchId'=$1 order by measurement_target_business_id", [batchId])).rows;
    if (Number(second.additionalChanges) !== 0 || persistedDigestBeforeSecond !== digest(insertedAfterSecond)) throw new Error("LOCAL_SECOND_RUN_CHANGED");
    const immutableChanged = digest(assignmentsBefore) !== digest((await local.query("select * from public.preliminary_survey_v2_measurement_assignments order by id")).rows)
      || digest(legacyBefore) !== digest((await local.query("select * from public.preliminary_survey order by id")).rows)
      || digest(targetsBefore) !== digest((await local.query("select * from public.measurement_target_business order by id")).rows)
      || digest(journalsBefore) !== digest((await local.query("select * from public.measurement_journal order by id")).rows);
    if (immutableChanged) throw new Error("HISTORY_RECOVERY_SOURCE_CHANGED");

    await local.query("begin");
    await local.query("set local role service_role");
    const rollback = (await local.query("select public.rollback_preliminary_survey_v2_historical_plans($1,$2) value", [batchId, recoverable])).rows[0].value;
    await local.query("commit");
    const planRowsAfterRollback = (await local.query("select * from public.preliminary_survey_v2_plans order by id")).rows;
    const auditAfterRollback = (await local.query("select count(*)::integer count,count(*) filter(where rolled_back_at is not null)::integer rolled_back from public.preliminary_survey_v2_history_recovery_audit where batch_id=$1", [batchId])).rows[0];
    if (digest(existingPlanRowsBefore) !== digest(planRowsAfterRollback) || Number(auditAfterRollback.count) !== manifest.length
        || Number(auditAfterRollback.rolled_back) !== recoverable) throw new Error("LOCAL_ROLLBACK_FAILED");

    const manifestPath = "C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-history-recovery-manifest.json";
    const manifestFile = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestPath, manifestFile);
    const manifestFileSha256 = createHash("sha256").update(manifestFile).digest("hex");
    const evidence = { generatedAt: new Date().toISOString(), batchId, manifestSha, contextHash, counts,
      manifestRows: manifest.length, recoverable, first, second, rollback, expectedActualMismatch: 0,
      existingV2Changed: 0, assignmentChanged: 0, sourceChanged: 0, secondRunAdditionalChanges: 0,
      trueConfirmedGuardBlocked, planFieldMismatch: 0, protectedWrites: 0,
      rollbackAuditRows: Number(auditAfterRollback.count), rollbackMarked: Number(auditAfterRollback.rolled_back),
      manifestPath, manifestFileSha256,
      unresolved: manifest.filter((row) => !["EXISTING_V2_PRESERVED", "HISTORICAL_EXACT_RECOVERY"].includes(row.classification))
        .map((row) => ({ code: row.code, classification: row.classification, exclusionReason: row.exclusionReason,
          legacyPreliminarySurveyor: row.legacyPreliminarySurveyor })) };
    const output = "C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-history-docker-evidence.json";
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ output, outputSha256: digest(evidence), ...evidence }, null, 2));

    await local.query("begin");
    await local.query("select set_config('app.preliminary_survey_admin_repair','on',true)");
    await local.query("delete from public.preliminary_survey_v2_history_recovery_audit");
    await local.query("delete from public.preliminary_survey_v2_history_recovery_batches");
    await local.query("delete from public.preliminary_survey_v2_measurement_assignments");
    await local.query("delete from public.measurement_journal");
    await local.query("delete from public.preliminary_survey_v2_plans");
    await local.query("delete from public.user_schedule_blocks");
    await local.query("delete from public.preliminary_survey_policy_settings");
    await local.query("delete from public.preliminary_survey");
    await local.query("delete from public.measurement_target_business");
    await local.query("delete from public.business_info");
    await local.query("delete from public.users");
    await local.query("commit");
    const cleanup = await localCounts();
    if (Object.values(cleanup).some((value) => Number(value) !== 0)) throw new Error(`LOCAL_CLEANUP_FAILED:${JSON.stringify(cleanup)}`);
    console.log(JSON.stringify({ cleanup }));
  } catch (error) {
    try { await local.query("rollback"); } catch { /* noop */ }
    throw error;
  } finally {
    await local.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
