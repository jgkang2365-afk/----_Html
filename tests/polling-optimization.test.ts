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

  const firstIdle = nextWorkerPollingState(0, false);
  assert.deepEqual(firstIdle, { idlePollCount: 1, delayMs: 15_000 });

  const longIdle = nextWorkerPollingState(firstIdle.idlePollCount, false);
  assert.deepEqual(longIdle, { idlePollCount: 2, delayMs: 30_000 });
  assert.deepEqual(nextWorkerPollingState(longIdle.idlePollCount, false), longIdle);
});

test("background_jobs 작업 발견 또는 오류 activity는 5초 주기로 복귀한다", () => {
  assert.deepEqual(nextWorkerPollingState(2, true), {
    idlePollCount: 0,
    delayMs: 5_000,
  });
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

test("MES idle은 30초지만 실행 중 취소 감지와 timeout 상태 전이는 유지한다", () => {
  const source = readFileSync("mes_daemon.py", "utf8");

  assert.match(source, /MES_DAEMON_POLL_SECONDS", "30"/);
  assert.match(source, /while process\.poll\(\) is None:[\s\S]*is_cancel_requested\(\)[\s\S]*time\.sleep\(1\)/);
  assert.match(source, /MACRO_TIMEOUT_SECONDS/);
  assert.match(source, /update_queue\("success"\)/);
  assert.match(source, /update_queue\("error"/);
  assert.match(source, /update_queue\("cancelled"/);
  assert.match(source, /update_queue\("idle"\)/);
});

test("문서 orphan recovery만 5분이며 heartbeat와 Realtime fallback은 유지한다", () => {
  const worker = readFileSync("document_worker.py", "utf8");
  const realtime = readFileSync("document_worker_realtime.py", "utf8");

  assert.match(worker, /DOCUMENT_WORKER_ORPHAN_RECOVERY_SECONDS = 5 \* 60/);
  assert.match(worker, /DOCUMENT_WORKER_HEARTBEAT_SECONDS = 15/);
  assert.match(worker, /CancelledJobRecoveryMonitor\(client\)/);
  assert.match(realtime, /DEFAULT_RECOVERY_POLL_SECONDS = 6 \* 60 \* 60/);
  assert.match(realtime, /event="INSERT"/);
});

test("MES 자동 작업 완료 확인은 10초이고 종료 상태와 12분 timeout은 유지한다", () => {
  const source = readFileSync("lib/scheduler/background-tasks.ts", "utf8");

  assert.match(source, /MES_STATUS_POLL_MS = 10_000/);
  assert.match(source, /MES_COMPLETION_TIMEOUT_MS = 12 \* 60 \* 1000/);
  assert.match(source, /queueState\?\.status === 'success'/);
  assert.match(source, /\['error', 'cancelled'\]\.includes/);
});
