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
