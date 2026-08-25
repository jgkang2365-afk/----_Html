import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildLegacyReconciliationManifest,
  normalizeLegacyReconciliationPeriod,
} from "../lib/preliminary-survey-v2/legacy-reconciliation";

config({ path: ".env.local" });

const mode = process.argv.find((value) => value.startsWith("--mode="))?.split("=")[1] ?? "inventory";
const outputPath = resolve(process.argv.find((value) => value.startsWith("--output="))?.slice(9)
  ?? `C:/Users/USER/Downloads/2026-08-26_preliminary-survey-v2-legacy-${mode}.json`);
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!apiUrl || !serviceKey) throw new Error("SUPABASE_ENV_REQUIRED");
if (!/^https:\/\/[a-z]+\.supabase\.co$/i.test(apiUrl)) throw new Error("REMOTE_SUPABASE_URL_REQUIRED");
if (mode === "apply" && process.env.LEGACY_RECONCILIATION_PRODUCTION_WRITE !== "YES") {
  throw new Error("LEGACY_RECONCILIATION_PRODUCTION_WRITE_GUARD");
}
let cancelled = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { cancelled = true; });
const checkpoint = () => { if (cancelled) throw new Error("LEGACY_RECONCILIATION_CANCELLED"); };
const supabase = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function load() {
  const [legacyResult, targetResult, planResult, assignmentResult, userResult] = await Promise.all([
    supabase.from("preliminary_survey").select("*").eq("year", 2026).gte("measurement_date", "2026-08-01").order("id"),
    supabase.from("measurement_target_business").select("id,code,year,period,measurement_date,daily_staff").eq("year", 2026),
    supabase.from("preliminary_survey_v2_plans").select("id,measurement_target_business_id,status,recommended_date,survey_method"),
    supabase.from("preliminary_survey_v2_measurement_assignments").select("id,plan_id,measurement_date,assignee_user_id,survey_code"),
    supabase.from("users").select("id,name,is_active,survey_code"),
  ]);
  const error = legacyResult.error || targetResult.error || planResult.error || assignmentResult.error || userResult.error;
  if (error) throw error;
  return {
    sources: (legacyResult.data ?? []).filter((row) => normalizeLegacyReconciliationPeriod(row.period) === "하반기"),
    targets: targetResult.data ?? [], plans: planResult.data ?? [], assignments: assignmentResult.data ?? [], users: userResult.data ?? [],
  };
}

async function sourceHashes(ids: number[]) {
  const entries = await Promise.all(ids.map(async (id) => {
    const { data, error } = await supabase.rpc("preliminary_survey_v2_legacy_source_hash", { p_legacy_id: id });
    if (error) return [id, ""] as const;
    return [id, String(data ?? "")] as const;
  }));
  return new Map(entries);
}

async function main() {
checkpoint();
const before = await load();
checkpoint();
const hashes = await sourceHashes(before.sources.map((row) => Number(row.id)));
const manifest = buildLegacyReconciliationManifest({ ...before, sourceHashes: hashes } as any);
const counts = Object.fromEntries([...new Set(manifest.map((row) => row.classification))].sort()
  .map((classification) => [classification, manifest.filter((row) => row.classification === classification).length]));
const recoverable = manifest.filter((row) => row.classification === "ASSIGNMENT_ONLY_EXACT_RECOVERY").length;
const allHashesAvailable = manifest.every((row) => /^[a-f0-9]{64}$/.test(row.sourceHash));
let manifestSha: string | null = null;
if (allHashesAvailable) {
  const { data, error } = await supabase.rpc("preliminary_survey_v2_legacy_manifest_sha", { p_manifest: manifest });
  if (error) throw error;
  manifestSha = String(data);
}
let applyResult: unknown = null;
const batchId = process.env.LEGACY_RECONCILIATION_BATCH_ID ?? randomUUID();
if (mode === "apply") {
  if (!allHashesAvailable || !manifestSha) throw new Error("LEGACY_SOURCE_HASH_RPC_REQUIRED");
  if (before.sources.length !== 110 || recoverable !== 41) throw new Error("LEGACY_RECONCILIATION_EXPECTED_GATE");
  checkpoint();
  const latest = await load();
  const latestHashes = await sourceHashes(latest.sources.map((row) => Number(row.id)));
  const latestManifest = buildLegacyReconciliationManifest({ ...latest, sourceHashes: latestHashes } as any);
  const { data: latestSha, error: latestShaError } = await supabase.rpc("preliminary_survey_v2_legacy_manifest_sha", { p_manifest: latestManifest });
  if (latestShaError) throw latestShaError;
  if (String(latestSha) !== manifestSha) throw new Error("STALE_LEGACY_SOURCE");
  checkpoint();
  const { data, error } = await supabase.rpc("reconcile_preliminary_survey_v2_legacy_history", {
    p_batch_id: batchId, p_manifest: manifest, p_manifest_sha: manifestSha,
    p_expected_rows: manifest.length, p_expected_assignment_inserts: recoverable,
  });
  if (error) throw error;
  applyResult = data;
  checkpoint();
}

const after = await load();
const protectedSourceDigest = createHash("sha256").update(JSON.stringify(before.sources)).digest("hex");
const afterSourceDigest = createHash("sha256").update(JSON.stringify(after.sources)).digest("hex");
const evidence = {
  generatedAt: new Date().toISOString(), mode, apiUrl, batchId,
  sourceRows: before.sources.length, manifestRows: manifest.length, counts, recoverable,
  allHashesAvailable, manifestSha, applyResult,
  existingAssignmentBefore: before.assignments.length, existingAssignmentAfter: after.assignments.length,
  legacySourceDigestBefore: protectedSourceDigest, legacySourceDigestAfter: afterSourceDigest,
  legacySourceChanged: protectedSourceDigest !== afterSourceDigest,
  rawHistoricalCodes: Object.fromEntries(["FF", "GG"].map((code) => [code,
    before.sources.filter((row) => String(row.survey_code ?? "").trim() === code).length])),
  publicSampleSourceRows: before.sources.filter((row) => String(row.measurer ?? "").trim() && String(row.survey_code ?? "").trim()).length,
  publicSampleSourceDashRows: manifest.filter((row) => {
    const source = before.sources.find((candidate) => Number(candidate.id) === row.legacySurveyId);
    return String(source?.measurer ?? "").trim() && String(source?.survey_code ?? "").trim()
      && !row.targetId;
  }).length,
  manifest,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...evidence, manifest: undefined }, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
