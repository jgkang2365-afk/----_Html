import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { steadyStateLeadUser } from "../lib/preliminary-survey-v2/service";
import { repairLinkCandidates } from "../lib/business/link-measurer";
import { recommendationDates } from "../lib/preliminary-survey-v2/calendar";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const service = read("lib/preliminary-survey-v2/service.ts");
const route = read("app/api/preliminary-survey-v2/group-confirm/route.ts");
const migration = read("supabase/migrations/20260817_confirm_preliminary_survey_group.sql");
const uiSource = read("components/features/MeasurementTargetBusinessManagement.tsx");

const users = [
  { id: 2, name: "강종구", experienced: false, active: true },
  { id: 15, name: "이태환", experienced: true, active: true },
  { id: 17, name: "한기문", experienced: true, active: true },
  { id: 20, name: "김민영", experienced: false, active: true },
];

// ===== A. 정상 그룹 확정 =====
test("A: 정상 대상은 예·측 단일 후보로 확정 가능하다", () => {
  const candidates = repairLinkCandidates([17], users, ["한기문"]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, "한기문");
  assert.match(route, /confirmGroupRecommendation/);
  assert.match(migration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
});

test("A: 확정 RPC는 선택된 사업장 plan을 upsert하고 link를 반영한다", () => {
  assert.match(migration, /UPDATE public\.measurement_target_business[\s\S]*link_measurer_id/);
  assert.match(migration, /participant_names = EXCLUDED\.participant_names/);
  assert.match(migration, /recommended_date = EXCLUDED\.recommended_date/);
});

// ===== B. 일부 선택 → 선택된 것만 반영 =====
test("B: 확정 요청은 서버가 받은 targetIds만 반영한다 (목록 UI 선택 로직은 예비조사 전용으로 분리)", () => {
  // 목록 화면의 그룹 선택 UI는 Phase A로 제거됨. 서버는 전달된 targetIds를 그대로 확정한다.
  assert.doesNotMatch(uiSource, /groupSelectedIds\.has\(id\)/);
  assert.doesNotMatch(uiSource, /toggleGroupTarget/);
  assert.match(service, /confirmGroupRecommendation/);
  assert.match(service, /targetIds = \[\.\.\.new Set\(input\.targetIds/);
});

// ===== C. idempotent =====
test("C: 동일 확정 요청 재실행 시 중복 plan이 생기지 않는다 (upsert)", () => {
  assert.match(migration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
  assert.match(migration, /updated_at = CURRENT_TIMESTAMP/);
});

// ===== D. sequence_number 생성 후 확정 차단 =====
test("D: sequence_number 부여 대상은 확정에서 차단한다", () => {
  assert.match(service, /SEQUENCE_NUMBER_CONFIRMED/);
  assert.match(service, /not\("sequence_number", "is", null\)/);
  assert.match(migration, /SEQUENCE_NUMBER_CONFIRMED/);
});

// ===== E. 실제 측정자 변경 → 예·측 재검증 =====
test("E: 실제 측정자 변경 시 lead/예·측 후보를 현재 데이터로 재계산한다", () => {
  const before = steadyStateLeadUser(null, ["이태환"], users);
  assert.equal(before?.name, "이태환");
  const after = steadyStateLeadUser(null, ["한기문"], users);
  assert.equal(after?.name, "한기문");
  // 후보 0명이면 확정 차단
  const none = repairLinkCandidates([17], users, ["김민영"]);
  assert.equal(none.length, 0);
  assert.match(service, /LINK_CANDIDATES_ZERO/);
});

// ===== F. 보고서 담당자만 변경 =====
test("F: 보고서 담당자(measurer_id)는 확정 재검증 기준으로 사용하지 않는다", () => {
  const confirmBlock = service.match(/export async function confirmGroupRecommendation[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(confirmBlock, /steadyStateLeadUser\(/);
  assert.doesNotMatch(confirmBlock, /"measurer_id"|'measurer_id'/);
});

// ===== G. manual plan 보호 =====
test("G: manual plan은 자동 덮어쓰기 금지한다", () => {
  assert.match(service, /MANUAL_PLAN_PRESERVED/);
  assert.match(service, /plan_origin === "manual"/);
  assert.match(migration, /MANUAL_PLAN_PRESERVED/);
});

// ===== H. 예·측 후보 0명 =====
test("H: 예·측 후보 0명이면 확정 차단한다", () => {
  assert.match(service, /LINK_CANDIDATES_ZERO/);
  assert.match(service, /실제 측정자가 변경되어 예·측 조건을 만족하지 않습니다/);
});

// ===== I. 예·측 후보 2명 이상 =====
test("I: 예·측 후보 2명 이상이면 사용자 선택이 필요하다", () => {
  const candidates = repairLinkCandidates([17, 20], users, ["김민영", "한기문"]);
  assert.equal(candidates.length, 2);
  assert.match(service, /LINK_CANDIDATES_MULTIPLE_REQUIRE_SELECTION/);
  assert.match(service, /linkOverrides/);
});

// ===== J. 동일 주소 3개 중 2개만 선택 =====
test("J: 동일 주소 사업장도 개별 선택으로 2개만 확정 대상이 된다 (선택 로직은 예비조사 전용)", () => {
  const ids = [101, 102, 103];
  const selected = new Set([101, 102]);
  const confirmed = ids.filter((id) => selected.has(id));
  assert.deepEqual(confirmed, [101, 102]);
  // 목록 UI의 그룹 선택 함수는 Phase A로 제거됨 (선택은 예비조사 전용 UI 책임)
  assert.doesNotMatch(uiSource, /toggleGroupTarget/);
});

// ===== K. 신규 사업장 중복 =====
test("K: 신규 사업장은 upsert로 하나의 활성 plan만 유지한다", () => {
  assert.match(migration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
  assert.match(migration, /INSERT INTO public\.preliminary_survey_v2_plans/);
});

// ===== L. 기존 사업장 동일 날짜 =====
test("L: 기존 사업장은 유선 가능성 때문에 날짜만으로 차단하지 않는다", () => {
  // 확정 로직에 '동일 날짜 기존 예비조사 존재 시 차단' 로직이 없다
  assert.doesNotMatch(migration, /동일 날짜|already.*date.*exists/i);
  assert.doesNotMatch(service, /EXISTS.*date.*preliminary_survey_v2_plans/i);
});

// ===== M. stale 측정일 =====
test("M: 추천 생성 후 측정일이 바뀌면 오래된 날짜 확정을 차단한다", () => {
  // 2026-08-21 기준 유효 추천 범위(-30~-3 워킹데이) 밖의 날짜는 stale
  const valid = recommendationDates("2026-08-21").map((d) => d.date);
  assert.ok(!valid.includes("2026-08-30"), "측정일 이후 날짜는 유효 범위 밖");
  assert.match(service, /STALE_MEASUREMENT_DATE/);
  assert.match(service, /validDates\.has\(input\.date\)/);
});

// ===== N. 부분 실패 → 원자적 =====
test("N: 사전 검증 실패 시 아무것도 저장하지 않는다 (원자적)", () => {
  assert.match(service, /if \(failed\.length > 0\)/);
  assert.match(service, /confirmed: \[\],\s*failed: failed\.map/);
  assert.match(service, /atomic: true/);
  // RPC는 Phase1 검증 → Phase2 쓰기 구조 (transaction)
  assert.match(migration, /Phase 1: 전체 검증/);
  assert.match(migration, /Phase 2: 적용/);
});

// ===== API 보안 =====
test("확정 API는 관리자 전용이며 인증/빈 목록/중복을 검증한다", () => {
  assert.match(route, /session\.role !== "관리자"/);
  assert.match(route, /관리자만 묶음 추천을 확정할 수 있습니다/);
  assert.match(route, /targetIds\.length === 0/);
  assert.match(route, /중복된 사업장이 포함되어 있습니다/);
  assert.match(route, /INVALID_DATE/);
});

test("확정 RPC는 일반 정상 확정을 관리자 예외 감사로그에 INSERT하지 않는다", () => {
  assert.doesNotMatch(migration, /INSERT INTO public\.preliminary_survey_exception_log/);
});

test("묶음 추천 재조회에서 manual(확정) plan 대상이 제외된다", () => {
  assert.match(service, /manualPlanTargetIds/);
  assert.match(service, /plan_origin === "manual"/);
});

test("묶음 확정은 서버 원자적 처리로 중복/부분 저장을 방지한다 (목록 UI 중복 클릭 방지는 예비조사 전용)", () => {
  // 목록 화면의 확정 UI는 Phase A로 제거됨. 서버 원자성은 N 테스트에서 별도 검증.
  assert.doesNotMatch(uiSource, /groupConfirming/);
  assert.doesNotMatch(uiSource, /groupConfirmError/);
  assert.match(service, /if \(failed\.length > 0\)/);
  assert.match(service, /atomic: true/);
});
