import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isPreliminarySurveyV2AutomationEnabled,
  type ProcessChangedPolicySettings,
} from "../lib/preliminary-survey-v2/policy";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const service = read("lib/preliminary-survey-v2/service.ts");
const businessesRoute = read("app/api/businesses/route.ts");
const createRoute = read("app/api/businesses/create/route.ts");
const groupRecommendRoute = read("app/api/preliminary-survey-v2/group-recommend/route.ts");
const groupConfirmRoute = read("app/api/preliminary-survey-v2/group-confirm/route.ts");
const recommendRoute = read("app/api/preliminary-survey-v2/recommend/route.ts");
const adminRepairRoute = read("app/api/preliminary-survey-v2/admin-repair/route.ts");
const uiSource = read("components/features/MeasurementTargetBusinessManagement.tsx");

const offPolicy: ProcessChangedPolicySettings = {
  enabled: false, effectiveStartYear: null, effectiveStartPeriod: null, effectiveStartMeasurementDate: null,
};
const onPolicy: ProcessChangedPolicySettings = {
  enabled: true, effectiveStartYear: 2026, effectiveStartPeriod: "상반기", effectiveStartMeasurementDate: "2026-01-01",
};

// ===== 상위 정책 판정 함수 =====
test("정책 OFF이면 자동추천이 비활성화된다 (전역/대상 모두)", () => {
  assert.equal(isPreliminarySurveyV2AutomationEnabled(offPolicy), false);
  assert.equal(isPreliminarySurveyV2AutomationEnabled(offPolicy, { year: 2026, period: "하반기", measurementDate: "2026-08-01" }), false);
});

test("정책 ON + 대상 없음이면 자동추천이 활성화된다", () => {
  assert.equal(isPreliminarySurveyV2AutomationEnabled(onPolicy), true);
});

test("정책 ON이어도 적용 시작 기준 이전 대상은 비활성화된다", () => {
  const before = isPreliminarySurveyV2AutomationEnabled(onPolicy, { year: 2025, period: "하반기", measurementDate: "2025-12-01" });
  const at = isPreliminarySurveyV2AutomationEnabled(onPolicy, { year: 2026, period: "상반기", measurementDate: "2026-01-01" });
  const after = isPreliminarySurveyV2AutomationEnabled(onPolicy, { year: 2026, period: "하반기", measurementDate: "2026-08-01" });
  assert.equal(before, false);
  assert.equal(at, true);
  assert.equal(after, true);
});

// ===== A. 정책 OFF + 신규 사업장 생성 =====
test("A: 정책 OFF이면 ensureV2PlanForTarget이 paused를 반환한다 (자동 생성 없음)", () => {
  assert.match(service, /"paused"/);
  assert.match(service, /POLICY_DISABLED/);
  assert.match(service, /isPreliminarySurveyV2AutomationEnabled/);
  assert.match(service, /action: "paused"/);
});

test("A: 사업장 create는 V2 자동 생성 호출 없이 정상 수행된다 (Phase A 분리)", () => {
  assert.doesNotMatch(createRoute, /ensureV2PlanForTarget/);
  assert.match(createRoute, /businessCreated: true/);
});

// ===== B. 정책 OFF + 기존 사업장 수정 =====
test("B: 정책 OFF이면 reconcileV2AfterTargetChange가 재추천하지 않는다", () => {
  assert.match(service, /자동추천 정책이 중지되어 V2 재추천을 실행하지 않았습니다/);
  assert.match(service, /if \(!isPreliminarySurveyV2AutomationEnabled\(policy\)\)/);
});

// ===== C. 정책 OFF + 실제 측정자 변경 =====
test("C: 정책 OFF이면 실측정자 변경이 V2 participant/link/date 자동 변경을 유발하지 않는다", () => {
  // ensureV2PlanForTarget이 정책 게이트로 먼저 반환한다.
  const pausedIndex = service.indexOf('reason: "POLICY_DISABLED"');
  assert.ok(pausedIndex >= 0);
});

// ===== D. 보고서 담당자 변경 =====
test("D: 보고서 담당자(measurer_id)는 V2 자동 변경 기준이 아니다 (Phase A 분리)", () => {
  // 저장 경로에는 V2 재추천/재생성 호출이 없다.
  assert.doesNotMatch(businessesRoute, /reconcileV2AfterTargetChange/);
  assert.doesNotMatch(businessesRoute, /ensureV2PlanForTarget/);
});

// ===== E. 정책 OFF + group-recommend 차단 =====
test("E: 구형 group-recommend는 정책 flag와 무관하게 영구 차단한다", () => {
  assert.match(groupRecommendRoute, /LEGACY_WORKBENCH_DISABLED/);
  assert.match(groupRecommendRoute, /status: 410/);
  assert.doesNotMatch(groupRecommendRoute, /buildGroupRecommendation|loadGroupRecommendationTargets/);
});

// ===== F. 정책 OFF + group-confirm 차단 =====
test("F: 구형 group-confirm은 직접 호출해도 업무 데이터를 저장하지 않는다", () => {
  assert.match(groupConfirmRoute, /LEGACY_WORKBENCH_DISABLED/);
  assert.match(groupConfirmRoute, /status: 410/);
  assert.doesNotMatch(groupConfirmRoute, /\.rpc\(|\.insert\(|\.update\(|\.upsert\(/);
});

test("F: V2 recommend API도 정책 OFF에서 차단된다", () => {
  assert.match(recommendRoute, /PRELIMINARY_SURVEY_AUTOMATION_DISABLED/);
  assert.match(recommendRoute, /loadV2AutomationPolicy/);
});

// ===== G. 정책 OFF + 기존 V2 plan 조회 유지 =====
test("G: 정책 OFF여도 기존 V2 plan 조회가 유지된다 (예비조사 전용 영역/API의 PAUSE 게이트)", () => {
  // 목록/수정 모달의 예비조사 UI는 제거됨(Phase A). 정책 OFF 안내는 예비조사 전용 영역으로 이동.
  assert.doesNotMatch(uiSource, />예비조사 정보</);
  assert.doesNotMatch(uiSource, /예비조사 자동추천 중지/);
  assert.doesNotMatch(uiSource, /automationEnabled/);
  // 정책 OFF 게이트는 예비조사 전용 API(PAUSE)에 유지된다.
  assert.match(service, /if \(!isPreliminarySurveyV2AutomationEnabled\(policy\)\)/);
  assert.match(recommendRoute, /isPreliminarySurveyV2AutomationEnabled/);
});

// ===== H. 정책 OFF + 관리자 예외 정비 유지 =====
test("H: 관리자 예외 정비는 자동추천 정책 게이트를 두지 않아 정상 유지된다", () => {
  // admin-repair는 정책 OFF와 무관하게 동작한다 (자동추천이 아닌 명시적 정비)
  assert.doesNotMatch(adminRepairRoute, /isPreliminarySurveyV2AutomationEnabled/);
  assert.doesNotMatch(adminRepairRoute, /POLICY_DISABLED/);
});

// ===== I. 정책 OFF + measurement_journal 보호 유지 =====
test("I: 정책 OFF여도 measurement_journal(찐확정) 보호는 유지된다", () => {
  assert.match(service, /MEASUREMENT_JOURNAL_CONFIRMED/);
  assert.doesNotMatch(service, /not\("sequence_number", "is", null\)/);
});

// ===== J. 정책 ON 회귀 =====
test("J: 정책 ON이면 자동추천 판정이 활성화된다 (회귀)", () => {
  assert.equal(isPreliminarySurveyV2AutomationEnabled(onPolicy), true);
});

// ===== 기타 보호 =====
test("정책 OFF 상태는 기존 V2 데이터를 삭제/NULL 처리하지 않는다", () => {
  // ensureV2PlanForTarget/reconcile에는 일괄 삭제·NULL 코드가 없다
  assert.doesNotMatch(service, /update\([\s\S]*recommended_date: null/i);
  assert.doesNotMatch(service, /delete\(\).*preliminary_survey_v2_plans/i);
});

test("정책 OFF는 측정대상사업장 수정 자체를 막지 않는다 (저장 경로에 V2 자동호출 없음)", () => {
  // 측정대상사업장 저장 경로는 V2 자동생성/재추천을 호출하지 않는다 (Phase A 결합 제거)
  assert.doesNotMatch(businessesRoute, /ensureV2PlanForTarget/);
  assert.doesNotMatch(businessesRoute, /reconcileV2AfterTargetChange/);
});

test("목록/수정 모달에 묶음 추천 UI가 없다 (Phase A 목록 정리)", () => {
  assert.doesNotMatch(uiSource, /automationEnabled/);
  assert.doesNotMatch(uiSource, /openGroupRecommendation/);
  assert.doesNotMatch(uiSource, /예비조사 일정 추천 \(묶음\)/);
});

test("새로운 중복 feature flag를 만들지 않는다 (기존 policy_key 재사용)", () => {
  const api = read("app/api/admin/preliminary-survey-policy/route.ts");
  assert.match(api, /POLICY_KEY = "process_changed_preliminary_survey"/);
  assert.doesNotMatch(api, /GROUP_RECOMMEND_ENABLED|PARTICIPANT_RECOMMENDATION_ENABLED/);
});
