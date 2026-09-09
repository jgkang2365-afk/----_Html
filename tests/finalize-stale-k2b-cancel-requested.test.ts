import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260909095000_finalize_stale_k2b_cancel_requested.sql", "utf8");

type Job = { job_type: string; status: string; updatedMinutesAgo: number; started_at: string | null };

function finalizeStalePreclaimCancels(jobs: Job[]) {
  return jobs.map((job) => (
    ["k2b", "k2b_verify", "k2b_original_sync", "k2b_legacy_direct"].includes(job.job_type)
      && job.status === "cancel_requested"
      && job.started_at === null
      && job.updatedMinutesAgo > 30
      ? { ...job, status: "cancelled" }
      : job
  ));
}

function applyExistingLegacyProcessingPolicy(jobs: Job[]) {
  return jobs.map((job) => job.job_type === "k2b_legacy_direct" && job.status === "processing" && job.updatedMinutesAgo > 30
    ? { ...job, status: "failed" }
    : job);
}

function canEnqueue(jobs: Job[]) {
  return !jobs.some((job) => ["k2b", "k2b_verify", "k2b_original_sync", "k2b_legacy_direct"].includes(job.job_type)
    && ["pending", "processing", "cancel_requested"].includes(job.status));
}

test("stale pre-claim cancel_requested만 final cancelled로 정리하고 enqueue를 허용한다", () => {
  const after = finalizeStalePreclaimCancels([{ job_type: "k2b", status: "cancel_requested", updatedMinutesAgo: 31, started_at: null }]);
  assert.equal(after[0].status, "cancelled"); // Case 1
  assert.equal(canEnqueue(after), true);
});

test("recent cancel_requested, pending, processing은 각각 enqueue를 차단한다", () => {
  for (const job of [
    { job_type: "k2b", status: "cancel_requested", updatedMinutesAgo: 30, started_at: null }, // Case 2
    { job_type: "k2b_verify", status: "pending", updatedMinutesAgo: 90, started_at: null }, // Case 3
    { job_type: "k2b_original_sync", status: "processing", updatedMinutesAgo: 90, started_at: "2026-09-09T00:00:00Z" }, // Case 4
  ]) {
    assert.equal(canEnqueue(finalizeStalePreclaimCancels([job])), false);
  }
});

test("legacy stale processing 정책과 비K2B job은 변경하지 않는다", () => {
  const [legacy, nonK2b] = finalizeStalePreclaimCancels(applyExistingLegacyProcessingPolicy([
    { job_type: "k2b_legacy_direct", status: "processing", updatedMinutesAgo: 31, started_at: "2026-09-09T00:00:00Z" }, // Case 5: 함수의 기존 failed cleanup 대상
    { job_type: "email", status: "cancel_requested", updatedMinutesAgo: 31, started_at: null }, // Case 6
  ]));
  assert.equal(legacy.status, "failed");
  assert.equal(nonK2b.status, "cancel_requested");
});

test("선점된 오래된 cancel_requested는 자동 종료하지 않고 활성 차단으로 유지한다", () => {
  const after = finalizeStalePreclaimCancels([{ job_type: "k2b", status: "cancel_requested", updatedMinutesAgo: 31, started_at: "2026-09-09T00:00:00Z" }]);
  assert.equal(after[0].status, "cancel_requested");
  assert.equal(canEnqueue(after), false);
});

test("migration은 두 RPC의 lock 뒤 cleanup, ACL, schema reload 계약을 보존한다", () => {
  for (const signature of ["enqueue_k2b_automation_job", "claim_k2b_legacy_direct_job"]) {
    const section = migration.slice(migration.indexOf(`FUNCTION public.${signature}`));
    assert.match(section, /pg_advisory_xact_lock\(hashtext\('k2b-automation-serialization'\)\)/);
    assert.match(section, /job_type = 'k2b_legacy_direct' AND status = 'processing'/);
    assert.match(section, /status = 'cancel_requested'\s+AND started_at IS NULL\s+AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'/);
    assert.match(section, /status IN \('pending', 'processing', 'cancel_requested'\)/);
  }
  assert.match(migration, /status = 'cancelled', finished_at = COALESCE\(finished_at, CURRENT_TIMESTAMP\), updated_at = CURRENT_TIMESTAMP/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.enqueue_k2b_automation_job\(TEXT, JSONB\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_k2b_legacy_direct_job\(JSONB\) TO service_role/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
  assert.doesNotMatch(migration, /WHERE id\s*=/i);
});
