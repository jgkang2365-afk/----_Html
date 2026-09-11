import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AUTOMATION_JOB_STATUSES,
  documentIdempotencyKey,
  mesManualIdempotencyKey,
  mesScheduledIdempotencyKey,
  nationalSupportIdempotencyKey,
  terminalAutomationStatus,
} from "../lib/automation/jobs";

test("automation job status contract has only the approved states", () => {
  assert.deepEqual(AUTOMATION_JOB_STATUSES, [
    "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCEL_REQUESTED", "CANCELLED", "CONFIRM_REQUIRED",
  ]);
  assert.equal(terminalAutomationStatus("COMPLETED"), true);
  assert.equal(terminalAutomationStatus("CONFIRM_REQUIRED"), true);
  assert.equal(terminalAutomationStatus("RUNNING"), false);
});

test("idempotency keys are stable for one logical request", () => {
  assert.equal(mesManualIdempotencyKey("request-1"), "mes:manual:request-1");
  assert.equal(mesScheduledIdempotencyKey("11:30", "2026-09-11"), "mes:scheduled:2026-09-11:11:30");
  assert.equal(documentIdempotencyKey(4, ["B", "A"], ["v2", "v1"]), documentIdempotencyKey(4, ["A", "B"], ["v1", "v2"]));
  assert.equal(nationalSupportIdempotencyKey("lookup", "100", 2026, "하반기"), "national-support:lookup:100:2026:하반기");
});

test("migration protects payload and uses SKIP LOCKED atomic claim", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.automation_jobs/);
  assert.match(migration, /UNIQUE \(idempotency_key\)/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /automation_job_signals/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.automation_jobs FROM anon, authenticated/);
  assert.match(migration, /worker_lease_expires_at/);
  assert.match(migration, /reconcile_stale_automation_jobs/);
  assert.match(migration, /status = 'CONFIRM_REQUIRED'/);
});

test("MES upload requires explicit database synchronization acknowledgement", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "mes_download.py"), "utf8");
  assert.match(source, /res_data\.get\("syncSuccess"\) is True/);
  assert.match(source, /웹 DB 동기화 확인 실패/);
});
