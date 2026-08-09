import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  millisecondsUntil,
  RealtimeWakeCoordinator,
  runQueueDrainCycle,
  type WorkerWakeReason,
} from "../lib/automation/realtime-wake-coordinator";

test("Realtime 신호는 즉시 큐 확인을 실행한다", async () => {
  const reasons: WorkerWakeReason[] = [];
  const coordinator = new RealtimeWakeCoordinator(async (reason) => {
    reasons.push(reason);
  });

  await coordinator.wake("realtime-event");
  assert.deepEqual(reasons, ["realtime-event"]);
});

test("실행 중 중복 Realtime 신호가 와도 작업은 한 번만 선점한다", async () => {
  let jobPending = true;
  let processed = 0;
  let cycles = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });

  const coordinator = new RealtimeWakeCoordinator(async () => {
    cycles += 1;
    if (cycles === 1) {
      started();
      await blocked;
    }
    if (jobPending) {
      jobPending = false;
      processed += 1;
    }
  });

  const first = coordinator.wake("realtime-event");
  await entered;
  await Promise.all([
    coordinator.wake("realtime-event"),
    coordinator.wake("realtime-event"),
  ]);
  release();
  await first;

  assert.equal(processed, 1);
  assert.equal(cycles, 2);
});

test("시작·재연결·6시간 안전 확인은 maintenance 경로를 사용한다", async () => {
  const calls: Array<[WorkerWakeReason, boolean]> = [];
  const coordinator = new RealtimeWakeCoordinator(async (reason, maintenance) => {
    calls.push([reason, maintenance]);
  });

  await coordinator.wake("startup", true);
  await coordinator.wake("realtime-reconnected", true);
  await coordinator.wake("safety-check", true);

  assert.deepEqual(calls, [
    ["startup", true],
    ["realtime-reconnected", true],
    ["safety-check", true],
  ]);
});

test("maintenance 큐 확인은 stale 복구 후 기존 pending을 끝까지 처리한다", async () => {
  let staleRecoveries = 0;
  let futureSchedules = 0;
  const pending = [true, true, false];

  const processed = await runQueueDrainCycle({
    includeMaintenance: true,
    maxJobs: 100,
    shouldContinue: () => true,
    recoverStale: async () => { staleRecoveries += 1; },
    processNext: async () => pending.shift() ?? false,
    scheduleNext: async () => { futureSchedules += 1; },
  });

  assert.equal(processed, 2);
  assert.equal(staleRecoveries, 1);
  assert.equal(futureSchedules, 1);
});

test("future available_at은 짧은 polling 없이 정확한 단발 지연으로 계산한다", () => {
  const now = Date.parse("2026-08-09T00:00:00.000Z");
  assert.equal(millisecondsUntil("2026-08-09T00:05:00.000Z", now), 300_000);
  assert.equal(millisecondsUntil("2026-08-08T23:59:00.000Z", now), 0);
  assert.equal(millisecondsUntil("invalid", now), null);
});

test("WorkerDaemon은 Realtime 신호·미래 타이머·6시간 fallback을 사용한다", () => {
  const source = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(source, /SAFETY_CHECK_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(source, /table: REALTIME_SIGNAL_TABLE/);
  assert.match(source, /filter: 'status=eq\.pending'/);
  assert.match(source, /wakeCoordinator\.wake\("startup", true\)/);
  assert.match(source, /\? "realtime-reconnected"/);
  assert.match(source, /wakeCoordinator\.wake\(reason, true\)/);
  assert.match(source, /wakeCoordinator\.wake\("safety-check", true\)/);
  assert.match(source, /wakeCoordinator\.wake\("available-at"\)/);
  assert.match(source, /recoverStaleNationalSupportJobs/);
  assert.match(source, /removeChannel\(channel\)/);
  assert.doesNotMatch(source, /JOB_POLL_INTERVAL_MS|pollingInterval/);
});

test("Realtime publication은 민감 payload 대신 최소 pending 신호만 포함한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260809_add_background_job_realtime_wakeup.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.background_job_pending_signals/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF status, available_at/);
  assert.match(migration, /ADD TABLE public\.background_job_pending_signals/);
  assert.doesNotMatch(migration, /ADD TABLE public\.background_jobs/);
  assert.doesNotMatch(migration, /payload JSONB/);
});
