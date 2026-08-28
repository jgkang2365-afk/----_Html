import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { Client as PostgresClient } from "pg";
import {
  assertSupabaseEnvironment,
  SUPABASE_PROJECT_REFS,
} from "../lib/supabase/environment-guard";

const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localDatabaseUrl =
  process.env.LOCAL_SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("LOCAL_E2E_ENV_MISSING");
}
assertSupabaseEnvironment({
  appEnvironment,
  databaseUrl: supabaseUrl,
  productionProjectRef: SUPABASE_PROJECT_REFS.production,
  stagingProjectRef: SUPABASE_PROJECT_REFS.staging,
});
if (appEnvironment !== "local") throw new Error("LOCAL_E2E_REQUIRES_LOCAL_APP_ENV");
const localPostgresUrl = new URL(localDatabaseUrl);
if (
  !["postgres:", "postgresql:"].includes(localPostgresUrl.protocol) ||
  !["localhost", "127.0.0.1"].includes(localPostgresUrl.hostname.toLowerCase())
) {
  throw new Error("LOCAL_E2E_REMOTE_POSTGRES_BLOCKED");
}

const adminPassword = randomBytes(24).toString("base64url");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const port = 3107;
const baseUrl = `http://127.0.0.1:${port}`;
let cookie = "";
let createdTargetId: number | null = null;
let nextProcess: ReturnType<typeof spawn> | null = null;
let childOutput = "";
let cleanupPromise: Promise<void> | null = null;

function rememberOutput(chunk: Buffer) {
  childOutput = (childOutput + chunk.toString("utf8")).slice(-12_000);
}

async function requestJson(pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}:${pathname}:${JSON.stringify(body)}`);
  }
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  return body;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/test-env`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("LOCAL_NEXT_SERVER_NOT_READY");
}

async function planCount(targetId: number) {
  const { count, error } = await supabase
    .from("preliminary_survey_v2_plans")
    .select("id", { count: "exact", head: true })
    .eq("measurement_target_business_id", targetId);
  if (error) throw error;
  return count ?? 0;
}

async function planSnapshot(targetId: number) {
  const { data, error } = await supabase
    .from("preliminary_survey_v2_plans")
    .select("id, recommended_date, responsible_user_id, participant_user_ids, source_responsible_user_id, source_measurement_date, survey_method")
    .eq("measurement_target_business_id", targetId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function main() {
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const { error: passwordError } = await supabase
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("id", 9001);
  if (passwordError) throw passwordError;

  const nextBin = path.resolve("node_modules", "next", "dist", "bin", "next");
  nextProcess = spawn(
    process.execPath,
    [nextBin, "dev", "--turbo", "-p", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_PUBLIC_APP_ENV: "local",
        NEXT_PUBLIC_VERCEL_ENV: "development",
        SUPABASE_URL: supabaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  nextProcess.stdout?.on("data", rememberOutput);
  nextProcess.stderr?.on("data", rememberOutput);

  await waitForServer();
  await requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      name: "STAGING Admin Tester",
      password: adminPassword,
      rememberMe: false,
    }),
  });

  const created = await requestJson("/api/businesses", {
    method: "POST",
    body: JSON.stringify({
      code: "SYNCRUD",
      year: 2026,
      period: "하반기",
      business_name: "Synthetic CRUD Original",
      business_type: "existing",
      process_changed: false,
      measurement_date: "2026-10-15",
      plan_manager: "Synthetic Plan Manager",
    }),
  });
  createdTargetId = Number(created.data?.id);
  if (!Number.isInteger(createdTargetId)) throw new Error("LOCAL_CREATE_ID_MISSING");

  await requestJson("/api/businesses", {
    method: "PATCH",
    body: JSON.stringify({
      id: createdTargetId,
      code: "SYNCRUD",
      year: 2026,
      period: "하반기",
      updates: { business_name: "Synthetic CRUD Updated", notes: "Local E2E" },
    }),
  });

  const recommendationTargetIds = [10009, 10001];
  const previewBefore = (await Promise.all(recommendationTargetIds.map(planCount)))
    .reduce((sum, count) => sum + count, 0);
  const recommendation = await requestJson("/api/preliminary-survey-v2/workbench", {
    method: "POST",
    body: JSON.stringify({
      action: "recommend",
      targetIds: recommendationTargetIds,
      explicitTargetSelection: true,
    }),
  });
  const previewAfter = (await Promise.all(recommendationTargetIds.map(planCount)))
    .reduce((sum, count) => sum + count, 0);
  const drafts = Array.isArray(recommendation.drafts) ? recommendation.drafts : [];
  if (drafts.length === 0) throw new Error("LOCAL_RECOMMEND_NO_DRAFT");

  await requestJson("/api/preliminary-survey-v2/workbench", {
    method: "POST",
    body: JSON.stringify({ action: "apply", drafts, approveThirdAssignment: false }),
  });
  const appliedCount = (await Promise.all(recommendationTargetIds.map(planCount)))
    .reduce((sum, count) => sum + count, 0);

  for (const targetId of recommendationTargetIds) {
    await requestJson(`/api/preliminary-survey-v2/${targetId}`, { method: "DELETE" });
  }
  const deletedPlanCount = (await Promise.all(recommendationTargetIds.map(planCount)))
    .reduce((sum, count) => sum + count, 0);
  const { count: preservedTargetCount, error: preservedTargetError } = await supabase
    .from("measurement_target_business")
    .select("id", { count: "exact", head: true })
    .eq("id", 10009);
  if (preservedTargetError) throw preservedTargetError;

  const completeBefore = await planSnapshot(10011);
  const dateMissingBefore = await planSnapshot(10012);
  const surveyorMissingBefore = await planSnapshot(10013);
  const repairPreview = await requestJson("/api/preliminary-survey-v2/confirmed-document-repair", {
    method: "POST",
    body: JSON.stringify({ action: "preview", targetIds: [10011, 10012, 10013] }),
  });
  const repairDrafts = Array.isArray(repairPreview.drafts) ? repairPreview.drafts : [];
  if (repairDrafts.length !== 2) throw new Error(`LOCAL_REPAIR_DRAFT_COUNT:${repairDrafts.length}`);
  const repairApply = await requestJson("/api/preliminary-survey-v2/confirmed-document-repair", {
    method: "POST",
    body: JSON.stringify({
      action: "apply",
      targetIds: [10011, 10012, 10013],
      drafts: repairDrafts,
    }),
  });
  const completeAfter = await planSnapshot(10011);
  const dateMissingAfter = await planSnapshot(10012);
  const surveyorMissingAfter = await planSnapshot(10013);
  if (JSON.stringify(completeAfter) !== JSON.stringify(completeBefore)) {
    throw new Error("LOCAL_REPAIR_OVERWROTE_COMPLETE_PLAN");
  }
  if (!dateMissingAfter?.recommended_date ||
      dateMissingAfter.responsible_user_id !== dateMissingBefore?.responsible_user_id) {
    throw new Error("LOCAL_REPAIR_DATE_ONLY_CONTRACT_FAILED");
  }
  if (surveyorMissingBefore !== null ||
      surveyorMissingAfter?.source_responsible_user_id !== 9101 ||
      !surveyorMissingAfter.responsible_user_id) {
    throw new Error("LOCAL_REPAIR_SURVEYOR_CONTRACT_FAILED");
  }

  await requestJson(`/api/businesses?id=${createdTargetId}`, { method: "DELETE" });
  createdTargetId = null;

  console.log(JSON.stringify({
    login: "PASS",
    create: "PASS",
    patch: "PASS",
    recommendationDrafts: drafts.length,
    previewWriteCount: previewAfter - previewBefore,
    appliedPlanCount: appliedCount,
    safeDeletePlanCount: deletedPlanCount,
    safeDeleteTargetPreserved: preservedTargetCount,
    confirmedRepairDrafts: repairDrafts.length,
    confirmedRepairApplied: Number(repairApply.repairedCount),
    confirmedCompletePlanUnchanged: true,
    confirmedDateOnlyRepair: "PASS",
    confirmedSurveyorRepair: "PASS",
  }));
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (nextProcess && nextProcess.exitCode === null) {
      const stopped = new Promise<void>((resolve) => {
        nextProcess?.once("exit", () => resolve());
        setTimeout(resolve, 5_000).unref();
      });
      nextProcess.kill();
      await stopped;
    }

    // Restore the deterministic reserved fixture after both success and failure.
    // This is local-only PostgreSQL and never accepts a cloud database URL.
    const postgres = new PostgresClient({ connectionString: localDatabaseUrl });
    await postgres.connect();
    try {
      const seedSql = await readFile(path.resolve("supabase", "seed.sql"), "utf8");
      await postgres.query(seedSql);
      createdTargetId = null;
    } finally {
      await postgres.end();
    }
  })();
  return cleanupPromise;
}

process.once("SIGINT", () => {
  void cleanup().finally(() => process.exit(130));
});

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "LOCAL_HTTP_E2E_FAILED");
    if (childOutput) console.error(childOutput);
    process.exitCode = 1;
  })
  .finally(cleanup);
