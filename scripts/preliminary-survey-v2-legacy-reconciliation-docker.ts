import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { buildLegacyReconciliationManifest, normalizeLegacyReconciliationPeriod } from "../lib/preliminary-survey-v2/legacy-reconciliation";

config({ path: ".env.local" });

const localUrl = process.env.STAGE2_LOCAL_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/127\.0\.0\.1|localhost/.test(localUrl)) throw new Error("PRODUCTION_WRITE_FORBIDDEN_IN_REHEARSAL");
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!apiUrl || !key) throw new Error("PRODUCTION_READ_ENV_REQUIRED");
const production = createClient(apiUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
const local = new Client({ connectionString: localUrl });
let cancelled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { cancelled = true; });
const checkpoint = () => { if (cancelled) throw new Error("LOCAL_REHEARSAL_CANCELLED"); };
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
const dateOnly = (value: unknown) => value instanceof Date ? dateFormatter.format(value) : String(value ?? "");

async function prod(table: string, columns: string, filters?: (query: any) => any) {
  let query: any = production.from(table).select(columns);
  if (filters) query = filters(query);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function insertRows(table: string, columns: string[], rows: any[]) {
  if (!rows.length) return;
  const quoted = columns.map((column) => `"${column}"`).join(",");
  for (const row of rows) {
    const values = columns.map((column) => {
      const value = row[column] ?? null;
      return value != null && typeof value === "object" ? JSON.stringify(value) : value;
    });
    await local.query(`insert into public.${table} (${quoted}) values (${columns.map((_, index) => `$${index + 1}`).join(",")})`, values);
  }
}

async function main() {
checkpoint();
const [sourcesAll, targets, plans, assignments, users, journals] = await Promise.all([
  prod("preliminary_survey", "id,code,measurement_date,end_date,measurement_weekdays,business_name,measurer,survey_code,address,preliminary_surveyor,actual_measurer,report_writer,created_at,updated_at,created_by,sequence_number,year,period,notes,date_details,google_event_id,assignee_manual_override",
    (query) => query.eq("year", 2026).gte("measurement_date", "2026-08-01").order("id")),
  prod("measurement_target_business", "id,year,period,code,measurement_date,daily_staff,business_name" , (query) => query.eq("year", 2026)),
  prod("preliminary_survey_v2_plans", "*"),
  prod("preliminary_survey_v2_measurement_assignments", "id,plan_id,measurement_date,assignee_user_id,survey_code,survey_code_source,assignment_reason,approval_required,approved_by_user_id,approved_at,created_at,updated_at,approval_group_fingerprint"),
  prod("users", "id,name,role,is_active,survey_code,is_preliminary_survey_experienced,is_preliminary_survey_support_assignable,is_preliminary_survey_manager"),
  prod("measurement_journal", "id,code,measurement_year,measurement_period,designated_office,business_name" , (query) => query.eq("measurement_year", 2026)),
]);
const sources = sourcesAll.filter((row: any) => normalizeLegacyReconciliationPeriod(row.period) === "하반기");
await local.connect();
try {
  const initial = await local.query(`select
    (select count(*) from public.users) users,
    (select count(*) from public.measurement_target_business) targets,
    (select count(*) from public.preliminary_survey) legacy,
    (select count(*) from public.business_info) business_info,
    (select count(*) from public.preliminary_survey_v2_plans) plans,
    (select count(*) from public.preliminary_survey_v2_measurement_assignments) assignments,
    (select count(*) from public.preliminary_survey_v2_legacy_reconciliation) reconciliation`);
  if (Object.values(initial.rows[0]).some((value) => Number(value) !== 0)) throw new Error("LOCAL_FIXTURE_NOT_EMPTY");
  await local.query("begin");
  await insertRows("users", ["id","name","role","is_active","survey_code","is_preliminary_survey_experienced","is_preliminary_survey_support_assignable","is_preliminary_survey_manager"], users);
  await insertRows("measurement_target_business", ["id","year","period","code","measurement_date","daily_staff","business_name"], targets);
  await insertRows("preliminary_survey", ["id","code","measurement_date","end_date","measurement_weekdays","business_name","measurer","survey_code","address","preliminary_surveyor","actual_measurer","report_writer","created_at","updated_at","created_by","sequence_number","year","period","notes","date_details","google_event_id","assignee_manual_override"], sources);
  await insertRows("preliminary_survey_v2_plans", ["id","measurement_target_business_id","recommended_date","responsible_user_id","experienced_reviewer_id","participant_user_ids","participant_names","status","plan_origin","source_measurement_date","source_responsible_user_id","source_rule_type","survey_method","recommendation_reason","route_evidence","warnings","created_at","updated_at"], plans);
  await insertRows("preliminary_survey_v2_measurement_assignments", ["id","plan_id","measurement_date","assignee_user_id","survey_code","survey_code_source","assignment_reason","approval_required","approved_by_user_id","approved_at","created_at","updated_at","approval_group_fingerprint"], assignments);
  await insertRows("business_info", ["code","business_name"], [...new Map(journals.map((row: any) => [
    String(row.code), { code: String(row.code), business_name: String(row.business_name || row.code) },
  ])).values()]);
  await insertRows("measurement_journal", ["id","code","measurement_year","measurement_period","designated_office","business_name"], journals);
  await local.query("commit");
  checkpoint();

  const localSources = (await local.query("select * from public.preliminary_survey where year=2026 and measurement_date>=date '2026-08-01' order by id")).rows
    .map((row) => ({ ...row, measurement_date: dateOnly(row.measurement_date) }));
  const localTargets = (await local.query("select id,code,year,period,measurement_date,daily_staff from public.measurement_target_business")).rows;
  const localPlans = (await local.query("select id,measurement_target_business_id,status,recommended_date,survey_method from public.preliminary_survey_v2_plans")).rows
    .map((row) => ({ ...row, recommended_date: row.recommended_date == null ? null : dateOnly(row.recommended_date) }));
  const localAssignments = (await local.query("select id,plan_id,measurement_date,assignee_user_id,survey_code from public.preliminary_survey_v2_measurement_assignments order by id")).rows
    .map((row) => ({ ...row, measurement_date: dateOnly(row.measurement_date) }));
  const localUsers = (await local.query("select id,name,is_active,survey_code from public.users")).rows;
  const hashRows = (await local.query("select id, public.preliminary_survey_v2_legacy_source_hash(id) source_hash from public.preliminary_survey order by id")).rows;
  const manifest = buildLegacyReconciliationManifest({
    sources: localSources, targets: localTargets, plans: localPlans, assignments: localAssignments, users: localUsers,
    sourceHashes: new Map(hashRows.map((row) => [Number(row.id), String(row.source_hash)])),
  });
  const manifestSha = String((await local.query("select public.preliminary_survey_v2_legacy_manifest_sha($1::jsonb) sha", [JSON.stringify(manifest)])).rows[0].sha);
  const recoverable = manifest.filter((row) => row.classification === "ASSIGNMENT_ONLY_EXACT_RECOVERY").length;
  if (manifest.length !== 110 || recoverable !== 41) {
    const diagnostic = Object.fromEntries([...new Set(manifest.map((row) => row.classification))]
      .map((classification) => [classification, manifest.filter((row) => row.classification === classification).length]));
    const sampleSource = localSources.find((row) => row.code === "H0051");
    const sampleTarget = localTargets.find((row) => row.code === "H0051");
    const samplePlan = localPlans.find((row) => Number(row.measurement_target_business_id) === Number(sampleTarget?.id));
    const sampleUser = localUsers.find((row) => row.name === sampleSource?.measurer);
    throw new Error(`LOCAL_CANONICAL_COUNT_MISMATCH:${manifest.length}:${recoverable}:${JSON.stringify({ diagnostic, sampleSource, sampleTarget, samplePlan, sampleUser, sampleManifest: manifest.find((row) => row.legacySurveyId === Number(sampleSource?.id)) })}`);
  }

  const sourceDigestBefore = createHash("sha256").update(JSON.stringify(localSources)).digest("hex");
  const existingAssignmentDigestBefore = createHash("sha256").update(JSON.stringify(localAssignments)).digest("hex");
  const guarded = manifest.find((row) => row.classification === "ASSIGNMENT_ONLY_EXACT_RECOVERY");
  if (!guarded) throw new Error("TRUE_CONFIRMED_GUARD_FIXTURE_REQUIRED");
  await local.query("begin");
  let guardBlocked = false;
  try {
    await local.query(`insert into public.preliminary_survey_v2_measurement_assignments
      (plan_id,measurement_date,assignee_user_id,survey_code,assignment_reason)
      select p.id,$1,u.id,u.survey_code,'GUARD_PROBE'
      from public.preliminary_survey_v2_plans p join public.users u on u.id=$2
      where p.measurement_target_business_id=$3`, [
      localSources.find((row) => Number(row.id) === guarded.legacySurveyId)!.measurement_date,
      guarded.matchedPublicSampleUserId, guarded.targetId,
    ]);
  } catch (error) {
    guardBlocked = /TRUE_CONFIRMED_LOCKED/.test(String((error as Error).message));
  }
  await local.query("rollback");
  if (!guardBlocked) throw new Error("TRUE_CONFIRMED_GENERAL_WRITE_NOT_BLOCKED");

  const batchId = randomUUID();
  await local.query("begin");
  await local.query("set local role service_role");
  const first = (await local.query("select public.reconcile_preliminary_survey_v2_legacy_history($1,$2::jsonb,$3,$4,$5) result",
    [batchId, JSON.stringify(manifest), manifestSha, manifest.length, recoverable])).rows[0].result;
  await local.query("commit");
  checkpoint();
  const persisted = (await local.query("select * from public.preliminary_survey_v2_measurement_assignments where assignment_origin='legacy_reconciled' order by legacy_preliminary_survey_id")).rows;
  const audit = (await local.query("select * from public.preliminary_survey_v2_legacy_reconciliation order by legacy_preliminary_survey_id")).rows;
  if (persisted.length !== 41 || audit.length !== 110) throw new Error("LOCAL_EXPECTED_ACTUAL_MISMATCH");
  if (audit.some((row) => ["FF","GG"].includes(row.legacy_survey_code_raw) && !["FF","GG"].includes(row.source_snapshot.survey_code))) {
    throw new Error("LEGACY_RAW_CODE_NOT_PRESERVED");
  }
  const displayDashWithSource = audit.filter((row) => String(row.legacy_public_sample_measurer ?? "").trim()
    && String(row.legacy_survey_code_raw ?? "").trim()
    && !(row.applied_assignment_id || row.reconciliation_status === "snapshot_only" || row.reconciliation_status === "existing_v2_preserved"));
  if (displayDashWithSource.length) throw new Error("SOURCE_BACKED_PUBLIC_SAMPLE_DASH");

  const persistedDigestBeforeSecond = createHash("sha256").update(JSON.stringify(persisted)).digest("hex");
  await local.query("begin");
  await local.query("set local role service_role");
  const second = (await local.query("select public.reconcile_preliminary_survey_v2_legacy_history($1,$2::jsonb,$3,$4,$5) result",
    [batchId, JSON.stringify(manifest), manifestSha, manifest.length, recoverable])).rows[0].result;
  await local.query("commit");
  const persistedAfterSecond = (await local.query("select * from public.preliminary_survey_v2_measurement_assignments where assignment_origin='legacy_reconciled' order by legacy_preliminary_survey_id")).rows;
  const persistedDigestAfterSecond = createHash("sha256").update(JSON.stringify(persistedAfterSecond)).digest("hex");
  if (Number(second.additionalChanges) !== 0 || persistedDigestBeforeSecond !== persistedDigestAfterSecond) throw new Error("LOCAL_SECOND_RUN_CHANGED");
  const sourceDigestAfter = createHash("sha256").update(JSON.stringify(
    (await local.query("select * from public.preliminary_survey where year=2026 and measurement_date>=date '2026-08-01' order by id")).rows
      .map((row) => ({ ...row, measurement_date: dateOnly(row.measurement_date) })),
  )).digest("hex");
  const existingAssignmentDigestAfter = createHash("sha256").update(JSON.stringify(
    (await local.query("select id,plan_id,measurement_date,assignee_user_id,survey_code from public.preliminary_survey_v2_measurement_assignments where assignment_origin='v2' order by id")).rows
      .map((row) => ({ ...row, measurement_date: dateOnly(row.measurement_date) })),
  )).digest("hex");
  if (sourceDigestBefore !== sourceDigestAfter || existingAssignmentDigestBefore !== existingAssignmentDigestAfter) {
    throw new Error(`PROTECTED_SOURCE_CHANGED:${sourceDigestBefore === sourceDigestAfter}:${existingAssignmentDigestBefore === existingAssignmentDigestAfter}`);
  }

  await local.query("begin");
  await local.query("set local role service_role");
  const rollbackResult = (await local.query(
    "select public.rollback_preliminary_survey_v2_legacy_reconciliation($1,$2) result", [batchId, recoverable],
  )).rows[0].result;
  await local.query("commit");
  const rollbackAssignments = Number((await local.query(
    "select count(*) count from public.preliminary_survey_v2_measurement_assignments where assignment_origin='legacy_reconciled'",
  )).rows[0].count);
  const rollbackAudit = (await local.query(
    "select count(*) count, count(*) filter(where reconciliation_status='rolled_back') rolled_back from public.preliminary_survey_v2_legacy_reconciliation",
  )).rows[0];
  if (rollbackAssignments !== 0 || Number(rollbackAudit.count) !== 110 || Number(rollbackAudit.rolled_back) !== 41) {
    throw new Error("LOCAL_ROLLBACK_AUDIT_FAILED");
  }

  const evidence = { generatedAt: new Date().toISOString(), manifestSha, batchId, manifestRows: manifest.length,
    recoverable, first, second, guardBlocked, persistedRows: persisted.length, auditRows: audit.length,
    expectedActualMismatch: 0, sourceChanged: 0, existingV2Changed: 0, displayDashWithSource: 0,
    rollbackResult, rollbackAuditPreserved: Number(rollbackAudit.count), rollbackAssignments,
    rawCodes: { FF: audit.filter((row) => row.legacy_survey_code_raw === "FF").length,
      GG: audit.filter((row) => row.legacy_survey_code_raw === "GG").length } };
  const output = "C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-legacy-docker-evidence.json";
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...evidence }, null, 2));

  await local.query("begin");
  await local.query("select set_config('app.preliminary_survey_admin_repair','on',true)");
  await local.query("delete from public.preliminary_survey_v2_legacy_reconciliation");
  await local.query("delete from public.preliminary_survey_v2_measurement_assignments");
  await local.query("delete from public.measurement_journal");
  await local.query("delete from public.preliminary_survey_v2_plans");
  await local.query("delete from public.preliminary_survey");
  await local.query("delete from public.measurement_target_business");
  await local.query("delete from public.business_info");
  await local.query("delete from public.users");
  await local.query("commit");
  const cleanup = await local.query(`select
    (select count(*) from public.users) users,
    (select count(*) from public.measurement_target_business) targets,
    (select count(*) from public.preliminary_survey) legacy,
    (select count(*) from public.business_info) business_info,
    (select count(*) from public.preliminary_survey_v2_plans) plans,
    (select count(*) from public.preliminary_survey_v2_measurement_assignments) assignments,
    (select count(*) from public.preliminary_survey_v2_legacy_reconciliation) reconciliation`);
  if (Object.values(cleanup.rows[0]).some((value) => Number(value) !== 0)) throw new Error("LOCAL_CLEANUP_FAILED");
  console.log(JSON.stringify({ cleanup: cleanup.rows[0] }));
} catch (error) {
  try { await local.query("rollback"); } catch { /* noop */ }
  throw error;
} finally {
  await local.end();
}
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
