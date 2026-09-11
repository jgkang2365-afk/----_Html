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
import {
  hasMeasurementJournalForTarget,
  nationalSupportCompatibilityStatus,
} from "../lib/national-support/automation-contract";

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
  assert.match(migration, /effect_started_at IS NULL/);
  assert.match(migration, /status = 'PENDING'/);
  assert.match(migration, /effect_confirmed_at IS NOT NULL/);
  assert.match(migration, /claim_next_document_generation_job/);
});

test("Production canonical journal key and compatibility projection are fixed", async () => {
  const calls: Array<[string, unknown]> = [];
  const query: any = {
    select: () => query,
    eq: (column: string, value: unknown) => { calls.push([column, value]); return query; },
    limit: async () => ({ data: [], error: null }),
  };
  const client: any = { from: () => query };
  assert.equal(await hasMeasurementJournalForTarget(client, { code: "A", year: 2026, period: "하반기" }), false);
  assert.deepEqual(calls, [["code", "A"], ["measurement_year", 2026], ["measurement_period", "하반기"]]);
  assert.equal(nationalSupportCompatibilityStatus("SUPPORT"), "성공");
  assert.equal(nationalSupportCompatibilityStatus("NON_SUPPORT"), "성공");
  assert.equal(nationalSupportCompatibilityStatus("OVER_50_RECHECK"), "비대상대기");
  assert.equal(nationalSupportCompatibilityStatus("NO_EMPLOYEE_INFO_RECHECK"), "비대상대기");
  assert.equal(nationalSupportCompatibilityStatus("EMPLOYEE_CHECK_FAILED_RECHECK"), "비대상대기");
  assert.equal(nationalSupportCompatibilityStatus("APPLIED_WAITING_RESULT"), "신청완료대기");
  assert.equal(nationalSupportCompatibilityStatus("ALREADY_APPLIED"), "확인대기");
  assert.equal(nationalSupportCompatibilityStatus("APPLICATION_UNCERTAIN"), "수동확인필요");
});

test("document and national-support boundaries are explicit rather than inferred from display strings", () => {
  const documentWorker = fs.readFileSync(path.join(process.cwd(), "document_worker.py"), "utf8");
  const nationalWorker = fs.readFileSync(path.join(process.cwd(), "lib/automation/local-automation-worker.ts"), "utf8");
  const flow = fs.readFileSync(path.join(process.cwd(), "scratch/national_support_flow_cli.py"), "utf8");
  assert.match(documentWorker, /mark_final_publish_effect\(client, job_id\)/);
  assert.match(documentWorker, /effect-started/);
  assert.match(flow, /worker_boundary\("journal_guard_before_apply"\)/);
  assert.match(flow, /worker_boundary\("effect_started"\)/);
  assert.doesNotMatch(nationalWorker, /includes\(.*result/i);
});

test("MES upload requires explicit database synchronization acknowledgement", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "mes_download.py"), "utf8");
  assert.match(source, /res_data\.get\("syncSuccess"\) is True/);
  assert.match(source, /웹 DB 동기화 확인 실패/);
});
