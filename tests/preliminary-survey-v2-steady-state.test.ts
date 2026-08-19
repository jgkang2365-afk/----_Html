import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { steadyStateLeadUser } from "../lib/preliminary-survey-v2/service";
import { collectMeasurementStaffNames, repairLinkCandidates } from "../lib/business/link-measurer";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const service = read("lib/preliminary-survey-v2/service.ts");
const route = read("app/api/businesses/route.ts");
const createRoute = read("app/api/businesses/create/route.ts");
const uiSource = read("components/features/MeasurementTargetBusinessManagement.tsx");

const users = [
  { id: 2, name: "강종구", experienced: false, active: true },
  { id: 15, name: "이태환", experienced: true, active: true },
  { id: 16, name: "고유빈", experienced: false, active: true },
  { id: 17, name: "한기문", experienced: true, active: true },
  { id: 20, name: "김민영", experienced: false, active: true },
];

// ===== A. 단일일 + 실제 측정자 있음 → 자동 생성 =====
test("A: 단일일 + 실측정자 있으면 lead를 실측정자에서 정하고 예·측 후보를 계산한다", () => {
  const lead = steadyStateLeadUser(null, ["김민영"], users);
  assert.equal(lead?.name, "김민영");
  // 추천 참가자 [김민영, 한기문(경력)] ∩ 실측정자 [김민영] → 예·측 후보 = 김민영
  const candidates = repairLinkCandidates([20, 17], users, ["김민영"]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, "김민영");
});

test("A: 측정대상사업장 PATCH는 V2 자동 생성 함수를 호출하지 않는다 (Phase A 분리)", () => {
  assert.doesNotMatch(route, /ensureV2PlanForTarget/);
  assert.doesNotMatch(route, /reconcileV2AfterTargetChange/);
  assert.doesNotMatch(createRoute, /ensureV2PlanForTarget/);
});

// ===== B. 실제 측정자 없음 =====
test("B: 실측정자가 없으면 V2 서비스가 자동 생성하지 않는다 (서비스 자체 동작)", () => {
  assert.match(service, /if \(staff\.length === 0\) return \{ action: "blocked", reason: "NO_STAFF"/);
});

// ===== C. 보고서 담당자만 변경 → V2 자동 변경 없음 (Phase A 분리) =====
test("C: 보고서 담당자(measurer_id) 변경은 V2 재추천 사유가 아니다", () => {
  // 저장 경로에 steady-state/재추천 호출이 없다.
  assert.doesNotMatch(route, /steadyStateTriggered/);
  assert.doesNotMatch(route, /responsibleChanged =/);
  assert.doesNotMatch(route, /reconcileV2AfterTargetChange/);
});

// ===== D. 실제 측정자 변경 =====
test("D: 실제 측정자(collaborators/daily_staff)는 측정계획 저장 경로에 보존된다 (V2 자동 호출 없음)", () => {
  assert.doesNotMatch(route, /steadyStateTriggered/);
  assert.doesNotMatch(route, /ensureV2PlanForTarget/);
});

// ===== E. sequence_number 부여 후 자동 변경 차단 =====
test("E: sequence_number(확정) 후에는 자동 생성/변경하지 않는다", () => {
  assert.match(service, /SEQUENCE_NUMBER_CONFIRMED/);
  assert.match(service, /not\("sequence_number", "is", null\)/);
  assert.match(service, /action: "confirmed"/);
});

// ===== F. 다일 측정: 전체 기간 합집합 + Day1 강제 삽입 없음 =====
test("F: 다일 측정 실측정자는 daily_staff 전체 기간 합집합으로 계산하고 예·측 후보를 뽑는다", () => {
  const staff = collectMeasurementStaffNames({
    collaborators: null,
    dailyStaff: [
      { date: "2026-08-08", collaborators: ["김민영"] },
      { date: "2026-08-09", collaborators: ["강종구", "한기문"] },
    ],
  });
  assert.deepEqual([...staff].sort(), ["강종구", "김민영", "한기문"].sort());
  // 참가자 [한기문(lead)] ∩ staff → 한기문 (Day2 참여)
  const candidates = repairLinkCandidates([17], users, staff);
  assert.ok(candidates.some((user) => user.name === "한기문"));
});

test("F: 서비스가 다일 실측정자 합집합을 사용한다 (collectMeasurementStaffNames)", () => {
  assert.match(service, /collectMeasurementStaffNames/);
  assert.match(service, /dailyStaff: target\.daily_staff/);
});

// ===== G. 추천일 없음 → manual_required =====
test("G: -3일까지 가용일 없으면 manual_required로 처리하고 UI에 수동 지정 안내를 표시한다", () => {
  assert.match(service, /"manual_required"/);
  assert.match(service, /NO_AVAILABLE_DATE_THROUGH_MINUS_3/);
  assert.match(service, /result\.status === "manual_required"/);
});

// ===== 안전성 =====
test("lead는 link(예·측)가 지정되면 그것을 우선 사용하고, 보고서 담당자는 사용하지 않는다", () => {
  // link(17) 지정 시 staff에 김민영이 있어도 한기문이 lead
  const lead = steadyStateLeadUser(17, ["김민영"], users);
  assert.equal(lead?.id, 17);
  // staff에 없는 사용자는 lead가 될 수 없다
  const none = steadyStateLeadUser(null, ["배윤민"], users);
  assert.equal(none, null);
});

test("자동 생성은 measurement_target_business_id 기준 upsert로 중복 plan을 만들지 않는다", () => {
  const migration = read("supabase/migrations/20260815090000_unify_v2_persist_classification_and_batch.sql");
  assert.match(migration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
});

test("저장 응답에 V2 plan 자동생성 의존이 없다 (Phase A 분리)", () => {
  assert.doesNotMatch(route, /preliminarySurveyV2Notice/);
  assert.doesNotMatch(createRoute, /preliminarySurveyV2Notice/);
  assert.doesNotMatch(createRoute, /preliminarySurveyV2Plan/);
  assert.doesNotMatch(uiSource, /result\.preliminarySurveyV2Plan/);
});

test("manual plan은 자동으로 덮어쓰지 않는다", () => {
  assert.match(service, /existingPlan\.plan_origin === "manual"/);
  assert.match(service, /MANUAL_PLAN_PRESERVED/);
  assert.match(service, /자동으로 덮어쓰지 않습니다/);
});
