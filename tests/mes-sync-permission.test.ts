import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canTriggerMesSync } from "../lib/permissions";

test("관리자는 직무와 관계없이 MES 수동 동기화를 실행할 수 있다", () => {
  assert.equal(canTriggerMesSync("관리자", "관리"), true);
  assert.equal(canTriggerMesSync("관리자", null), true);
});

test("측정 직무 사용자는 MES 수동 동기화를 실행할 수 있다", () => {
  assert.equal(canTriggerMesSync("사용자", "측정"), true);
});

test("측정 외 직무 또는 직무 미설정 사용자는 실행할 수 없다", () => {
  assert.equal(canTriggerMesSync("사용자", "관리"), false);
  assert.equal(canTriggerMesSync("사용자", null), false);
  assert.equal(canTriggerMesSync("사용자"), false);
});

test("MES 미등록 점검은 동일 연도·주기의 전체 등록분을 생성일 제한 없이 조회한다", () => {
  const source = readFileSync("lib/scheduler/background-tasks.ts", "utf8");
  assert.match(source, /\.in\("year", surveyYears\)/);
  assert.match(source, /\.in\("period", surveyPeriods\)/);
  assert.doesNotMatch(source, /\.gte\("created_at",/);
});

test("MES 자동 다운로드는 기존 11:30, 12:00, 14:00 스케줄을 유지한다", () => {
  const source = readFileSync("lib/scheduler/background-tasks.ts", "utf8");
  assert.match(source, /cron\.schedule\('30 11 \* \* \*'/);
  assert.match(source, /cron\.schedule\('0 12 \* \* \*'/);
  assert.match(source, /cron\.schedule\('0 14 \* \* \*'/);
  assert.match(source, /status: 'pending'/);
});

test("MES daemon은 polling 없이 Realtime과 조건부 pending 선점을 사용한다", () => {
  const daemon = readFileSync("mes_daemon.py", "utf8");
  const runtime = readFileSync("mes_daemon_realtime.py", "utf8");
  assert.doesNotMatch(daemon, /POLL_SECONDS|poll_forever/);
  assert.match(daemon, /\.eq\("status", "pending"\)/);
  assert.match(runtime, /DEFAULT_SAFETY_CHECK_SECONDS = 6 \* 60 \* 60/);
  assert.match(runtime, /event="UPDATE"/);
  assert.match(runtime, /filter=REALTIME_FILTER/);
  assert.match(runtime, /coordinator\.wake\("startup"\)/);
  assert.match(runtime, /"realtime-reconnected"/);
  assert.match(runtime, /coordinator\.wake\("safety-check"\)/);
  assert.match(runtime, /channel\.unsubscribe\(\)/);
});

test("웹 수동 MES 동기화도 동일 pending 큐를 통해 Realtime worker를 깨운다", () => {
  const route = readFileSync("app/api/cron/mes-trigger/route.ts", "utf8");
  assert.match(route, /\.from\("mes_sync_queue"\)/);
  assert.match(route, /status: "pending"/);
  assert.match(route, /canTriggerMesSync/);
});
