import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NATIONAL_SUPPORT_STALE_THRESHOLD_MS,
  NATIONAL_SUPPORT_STALE_WATCHDOG_MS,
  WORKER_ACTIVE_POLL_MS,
  nextWorkerPollingState,
} from "../lib/automation/worker-polling-policy";

test("background_jobs idle backoff는 5초에서 15초, 최대 30초로 증가한다", () => {
  assert.equal(WORKER_ACTIVE_POLL_MS, 5_000);

  const firstIdle = nextWorkerPollingState(0, "idle");
  assert.deepEqual(firstIdle, { idlePollCount: 1, delayMs: 15_000 });

  const longIdle = nextWorkerPollingState(firstIdle.idlePollCount, "idle");
  assert.deepEqual(longIdle, { idlePollCount: 2, delayMs: 30_000 });
  assert.deepEqual(
    nextWorkerPollingState(longIdle.idlePollCount, "idle"),
    longIdle,
  );
});

test("background_jobs 작업 발견은 5초 active polling으로 복귀한다", () => {
  assert.deepEqual(nextWorkerPollingState(2, "activity"), {
    idlePollCount: 0,
    delayMs: 5_000,
  });
});

test("background_jobs 오류는 15초에서 최대 30초로 backoff한다", () => {
  const firstError = nextWorkerPollingState(0, "error");
  assert.deepEqual(firstError, { idlePollCount: 1, delayMs: 15_000 });

  const repeatedError = nextWorkerPollingState(firstError.idlePollCount, "error");
  assert.deepEqual(repeatedError, { idlePollCount: 2, delayMs: 30_000 });
  assert.deepEqual(
    nextWorkerPollingState(repeatedError.idlePollCount, "error"),
    repeatedError,
  );
});

test("background_jobs 오류 후 정상 작업 발견 시 5초로 복귀한다", () => {
  const afterError = nextWorkerPollingState(0, "error");
  assert.notEqual(afterError.delayMs, WORKER_ACTIVE_POLL_MS);
  assert.deepEqual(nextWorkerPollingState(afterError.idlePollCount, "activity"), {
    idlePollCount: 0,
    delayMs: 5_000,
  });

  const source = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(source, /catch \(e: any\)[\s\S]*return "error"/);
});

test("national_support stale watchdog은 10분 기준을 유지하고 5분마다 분리 실행한다", () => {
  const source = readFileSync("lib/automation/worker-daemon.ts", "utf8");

  assert.equal(NATIONAL_SUPPORT_STALE_THRESHOLD_MS, 10 * 60 * 1_000);
  assert.equal(NATIONAL_SUPPORT_STALE_WATCHDOG_MS, 5 * 60 * 1_000);
  assert.match(source, /runStaleNationalSupportWatchdog/);
  assert.match(source, /\.eq\('job_type', 'national_support'\)/);
  assert.match(source, /\.eq\('status', 'processing'\)/);
  assert.match(source, /\.lt\('updated_at', staleThreshold\)/);
});

test("MES는 Realtime wake-up이며 실행 중 lease·취소·timeout을 유지한다", () => {
  const source = readFileSync("mes_daemon.py", "utf8");
  assert.match(source, /automation_job_signals/);
  assert.match(source, /wake\.set\(\)/);
  assert.doesNotMatch(source, /MES_DAEMON_POLL_SECONDS/);
  assert.match(source, /while process\.poll\(\) is None:[\s\S]*cancel_requested[\s\S]*time\.sleep\(0\.5\)/);
  assert.match(source, /MACRO_TIMEOUT_SECONDS/);
  assert.match(source, /renew_automation_job_lease/);
  assert.match(source, /status="COMPLETED"/);
  assert.match(source, /status="CONFIRM_REQUIRED"/);
});

test("문서 common worker는 heartbeat와 Realtime 재연결만 사용하며 5분 orphan polling을 재도입하지 않는다", () => {
  const worker = readFileSync("document_worker.py", "utf8");
  const realtime = readFileSync("document_worker_realtime.py", "utf8");
  const claim = readFileSync("app/api/document-worker/jobs/claim/route.ts", "utf8");

  assert.match(worker, /DOCUMENT_WORKER_HEARTBEAT_SECONDS = 15/);
  assert.doesNotMatch(worker, /CancelledJobRecoveryMonitor\(client\)\.start\(\)/);
  assert.match(realtime, /DEFAULT_RECOVERY_POLL_SECONDS = 6 \* 60 \* 60/);
  assert.match(realtime, /event="INSERT"/);
  assert.match(claim, /reconcile_stale_document_automation_jobs/);
});

test("MES 예약은 common job을 1회 enqueue하고 완료 polling을 하지 않는다", () => {
  const source = readFileSync("lib/scheduler/background-tasks.ts", "utf8");

  assert.match(source, /enqueueAutomationJob/);
  assert.match(source, /mesScheduledIdempotencyKey/);
  assert.doesNotMatch(source, /MES_STATUS_POLL_MS/);
});
