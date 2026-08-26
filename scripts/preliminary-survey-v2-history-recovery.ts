import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { recommendationDatesForBusinessType } from "../lib/preliminary-survey-v2/calendar";
import { buildHistoricalPlanRecoveryManifest } from "../lib/preliminary-survey-v2/historical-plan-recovery";
import { loadActualMeasurementBlockedKeys } from "../lib/preliminary-survey-v2/measurement-conflicts";

const envPath = process.argv.find((value) => value.startsWith("--env="))?.slice(6) ?? ".env.local";
config({ path: envPath });
const mode = process.argv.find((value) => value.startsWith("--mode="))?.slice(7) ?? "inventory";
const outputPath = resolve(process.argv.find((value) => value.startsWith("--output="))?.slice(9)
  ?? `C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-history-${mode}.json`);
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!apiUrl || !serviceKey) throw new Error("SUPABASE_ENV_REQUIRED");
if (!/^https:\/\/[a-z]+\.supabase\.co$/i.test(apiUrl)) throw new Error("REMOTE_SUPABASE_URL_REQUIRED");
if (mode === "apply") {
  if (process.env.HISTORY_RECOVERY_PRODUCTION_WRITE !== "YES") throw new Error("HISTORY_RECOVERY_PRODUCTION_WRITE_GUARD");
  if (new URL(apiUrl).hostname !== "xjxqbwvcgffunqnkmoqw.supabase.co") throw new Error("HISTORY_RECOVERY_PRODUCTION_PROJECT_MISMATCH");
}
const supabase = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
let cancelled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { cancelled = true; });
const checkpoint = () => { if (cancelled) throw new Error("HISTORY_RECOVERY_CANCELLED"); };

async function required<T>(promise: PromiseLike<{ data: T | null; error: unknown }>, label: string): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}:${JSON.stringify(error)}`);
  return data as T;
}

async function loadSource() {
  const [targets, legacySources, users, existingPlans, blocks, policy, assignments, journals] = await Promise.all([
    required<any[]>(supabase.from("measurement_target_business")
      .select("*")
      .eq("year", 2026).gte("measurement_date", "2026-08-01").lte("measurement_date", "2026-08-26").order("measurement_date").order("id"), "TARGET_QUERY"),
    required<any[]>(supabase.from("preliminary_survey")
      .select("*")
      .eq("year", 2026).gte("measurement_date", "2026-08-01").lte("measurement_date", "2026-08-26").order("id"), "LEGACY_QUERY"),
    required<any[]>(supabase.from("users")
      .select("*")
      .order("id"), "USER_QUERY"),
    required<any[]>(supabase.from("preliminary_survey_v2_plans")
      .select("*")
      .order("measurement_target_business_id"), "PLAN_QUERY"),
    required<any[]>(supabase.from("user_schedule_blocks")
      .select("*").lte("start_date", "2026-08-26").gte("end_date", "2026-06-01").order("id"), "BLOCK_QUERY"),
    required<any[]>(supabase.from("preliminary_survey_policy_settings")
      .select("policy_key,enabled").eq("policy_key", "process_changed_preliminary_survey"), "POLICY_QUERY"),
    required<any[]>(supabase.from("preliminary_survey_v2_measurement_assignments").select("*").order("id"), "ASSIGNMENT_QUERY"),
    required<any[]>(supabase.from("measurement_journal").select("*").eq("measurement_year", 2026).order("id"), "JOURNAL_QUERY"),
  ]);
  const candidateDates = [...new Set(targets.flatMap((target) =>
    recommendationDatesForBusinessType(String(target.measurement_date), "existing").map((candidate) => candidate.date)))];
  const scheduleBlockedKeys = new Set<string>();
  for (const block of blocks) for (const date of candidateDates) {
    if (String(block.start_date) <= date && String(block.end_date) >= date) scheduleBlockedKeys.add(`${block.user_id}:${date}`);
  }
  const measurementBlockedKeys = await loadActualMeasurementBlockedKeys(supabase as any, candidateDates, users);
  return { targets, legacySources, users, existingPlans, blocks, policy, assignments, journals, scheduleBlockedKeys, measurementBlockedKeys };
}

async function rpcText(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return String(data ?? "");
}

async function buildCanonical(source: Awaited<ReturnType<typeof loadSource>>) {
  const sourceEntries = await Promise.all(source.legacySources.map(async (row) => [Number(row.id),
    await rpcText("preliminary_survey_v2_history_source_hash", { p_legacy_id: row.id })] as const));
  const targetEntries = await Promise.all(source.targets.map(async (row) => [Number(row.id),
    await rpcText("preliminary_survey_v2_history_target_hash", { p_target_id: row.id })] as const));
  const contextHash = await rpcText("preliminary_survey_v2_history_context_hash", {});
  const manifest = buildHistoricalPlanRecoveryManifest({
    ...source,
    sourceHashes: new Map(sourceEntries), targetHashes: new Map(targetEntries), contextHash,
  });
  const manifestSha = await rpcText("preliminary_survey_v2_history_manifest_sha", { p_manifest: manifest });
  return { manifest, manifestSha, contextHash };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  checkpoint();
  const source = await loadSource();
  if (source.policy.length !== 1 || source.policy[0].enabled !== false) throw new Error("AUTOMATION_POLICY_MUST_REMAIN_OFF");
  const canonical = await buildCanonical(source);
  const counts = Object.fromEntries([...new Set(canonical.manifest.map((row) => row.classification))].sort()
    .map((classification) => [classification, canonical.manifest.filter((row) => row.classification === classification).length]));
  const recoverable = canonical.manifest.filter((row) => row.classification === "HISTORICAL_EXACT_RECOVERY").length;
  if (source.targets.length !== 88 || source.existingPlans.filter((plan) => source.targets.some((target) => target.id === plan.measurement_target_business_id)).length !== 42
      || canonical.manifest.length !== 88 || Number(counts.EXISTING_V2_PRESERVED ?? 0) !== 42) {
    throw new Error(`HISTORY_RECOVERY_BASELINE_CHANGED:${JSON.stringify({ targets: source.targets.length, counts })}`);
  }

  let applyResult: unknown = null;
  let secondResult: unknown = null;
  const batchId = process.env.HISTORY_RECOVERY_BATCH_ID ?? randomUUID();
  const beforePlans = source.existingPlans;
  if (mode === "apply") {
    checkpoint();
    const latest = await loadSource();
    const latestCanonical = await buildCanonical(latest);
    if (latestCanonical.manifestSha !== canonical.manifestSha || latestCanonical.contextHash !== canonical.contextHash) {
      throw new Error("STALE_HISTORY_RECOVERY_SOURCE");
    }
    const first = await supabase.rpc("recover_preliminary_survey_v2_historical_plans", {
      p_batch_id: batchId, p_manifest: canonical.manifest, p_manifest_sha: canonical.manifestSha,
      p_context_hash: canonical.contextHash, p_expected_scope: canonical.manifest.length,
      p_expected_plan_inserts: recoverable,
    });
    if (first.error) throw first.error;
    applyResult = first.data;
    checkpoint();
    const second = await supabase.rpc("recover_preliminary_survey_v2_historical_plans", {
      p_batch_id: batchId, p_manifest: canonical.manifest, p_manifest_sha: canonical.manifestSha,
      p_context_hash: canonical.contextHash, p_expected_scope: canonical.manifest.length,
      p_expected_plan_inserts: recoverable,
    });
    if (second.error) throw second.error;
    secondResult = second.data;
    checkpoint();
  }

  const after = await loadSource();
  const beforeExistingRows = beforePlans.filter((plan) => canonical.manifest.some((row) =>
    row.classification === "EXISTING_V2_PRESERVED" && row.targetId === plan.measurement_target_business_id));
  const afterExistingRows = after.existingPlans.filter((plan) => canonical.manifest.some((row) =>
    row.classification === "EXISTING_V2_PRESERVED" && row.targetId === plan.measurement_target_business_id));
  const evidence = {
    generatedAt: new Date().toISOString(), mode, project: new URL(apiUrl).hostname, batchId,
    targetCount: source.targets.length, existingPreserved: Number(counts.EXISTING_V2_PRESERVED ?? 0),
    missing: source.targets.length - Number(counts.EXISTING_V2_PRESERVED ?? 0), recoverable,
    unresolved: canonical.manifest.length - Number(counts.EXISTING_V2_PRESERVED ?? 0) - recoverable,
    counts, manifestSha: canonical.manifestSha, contextHash: canonical.contextHash,
    autoPolicyEnabled: source.policy[0].enabled, assignmentBefore: source.assignments.length,
    assignmentAfter: after.assignments.length, assignmentChanged: digest(source.assignments) !== digest(after.assignments),
    targetSourceChanged: digest(source.targets) !== digest(after.targets),
    legacySourceChanged: digest(source.legacySources) !== digest(after.legacySources),
    userSourceChanged: digest(source.users) !== digest(after.users),
    scheduleSourceChanged: digest(source.blocks) !== digest(after.blocks),
    journalSourceChanged: digest(source.journals) !== digest(after.journals),
    existingPlanDigestBefore: digest(beforeExistingRows), existingPlanDigestAfter: digest(afterExistingRows),
    existingPlanChanged: digest(beforeExistingRows) !== digest(afterExistingRows),
    applyResult, secondResult, manifest: canonical.manifest,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence, manifest: undefined, outputPath, outputSha256: digest(evidence) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
