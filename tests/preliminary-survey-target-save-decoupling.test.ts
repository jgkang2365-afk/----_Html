import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const businessesRoute = read("app/api/businesses/route.ts");
const createRoute = read("app/api/businesses/create/route.ts");
const service = read("lib/preliminary-survey-v2/service.ts");
const policy = read("lib/preliminary-survey-v2/policy.ts");
const uiSource = read("components/features/MeasurementTargetBusinessManagement.tsx");
const legacyUpsertMigration = read("supabase/migrations/20260819_preliminary_survey_unique.sql");
const excelSync = read("lib/sync/excel-sync.ts");

// ===== 측정대상사업장 저장 ↔ V2 자동 생성/재추천 결합 제거 =====
test("PATCH는 ensureV2PlanForTarget/reconcileV2AfterTargetChange를 호출하지 않는다", () => {
  assert.doesNotMatch(businessesRoute, /ensureV2PlanForTarget/);
  assert.doesNotMatch(businessesRoute, /reconcileV2AfterTargetChange/);
});

test("create는 ensureV2PlanForTarget을 호출하지 않는다", () => {
  assert.doesNotMatch(createRoute, /ensureV2PlanForTarget/);
});

test("저장(PATCH/create) 응답에 preliminarySurveyV2Plan/Notice 자동생성 의존이 없다", () => {
  assert.doesNotMatch(businessesRoute, /preliminarySurveyV2Notice/);
  // 저장(PATCH) 응답 본문에 preliminarySurveyV2Plan 자동생성 결과가 없다.
  // (GET 조회용 preliminary_survey_v2_plan 필드는 유지되므로 전체 부정은 금지)
  const patchResponseBlock = businessesRoute.match(/Decoupled[\s\S]*?return NextResponse\.json\(\{[\s\S]*?\}\);/);
  assert.ok(patchResponseBlock, "Decoupled 저장 응답 블록이 존재해야 한다");
  assert.doesNotMatch(patchResponseBlock[0], /preliminarySurveyV2Plan/);
  assert.doesNotMatch(createRoute, /preliminarySurveyV2Notice/);
  assert.doesNotMatch(createRoute, /preliminarySurveyV2Plan/);
});

test("UI는 저장 응답의 V2 plan으로 수정 모달을 즉시 갱신하지 않는다", () => {
  // 저장(PATCH) 응답의 preliminarySurveyV2Plan 기반 갱신이 제거됨
  assert.doesNotMatch(uiSource, /result\.preliminarySurveyV2Plan/);
  assert.doesNotMatch(uiSource, /result\.preliminarySurveyV2Notice/);
});

test("UI에 자동생성 전제 문구가 없다", () => {
  assert.doesNotMatch(uiSource, /예비조사 계획 생성 대기/);
  assert.doesNotMatch(uiSource, /자동 생성됩니다/);
  assert.doesNotMatch(uiSource, /저장 시 자동으로 예비조사 계획/);
});

// ===== legacy Integrated Sync 유지 =====
test("legacy Integrated Sync는 여전히 존재한다 (V2와 분리되어 유지)", () => {
  assert.match(businessesRoute, /Integrated Sync Logic/);
  assert.match(businessesRoute, /\.from\("preliminary_survey"\)/);
  assert.match(businessesRoute, /syncBusinessToCalendar/);
});

test("PR #34 legacy UNIQUE/UPSERT 방어는 유지된다", () => {
  assert.match(businessesRoute, /onConflict: "code,year,period,measurement_date"/);
  assert.match(businessesRoute, /isLegacySurveyUniqueConflict/);
  assert.match(legacyUpsertMigration, /ADD CONSTRAINT uq_preliminary_survey_code_year_period_measurement_date/);
  assert.doesNotMatch(legacyUpsertMigration, /DROP CONSTRAINT/);
});

test("excel-sync의 legacy 보정은 유지된다", () => {
  assert.match(excelSync, /onConflict: "code,year,period,measurement_date"/);
});

// ===== V2 서비스/전용 API 유지 =====
test("V2 서비스 함수는 삭제되지 않는다 (추후 예비조사 영역 재사용)", () => {
  assert.match(service, /export async function ensureV2PlanForTarget/);
  assert.match(service, /export async function reconcileV2AfterTargetChange/);
  assert.match(service, /export async function recommendAndPersistV2/);
});

test("V2 전용 API와 PAUSE 게이트는 유지된다", () => {
  const recommend = read("app/api/preliminary-survey-v2/recommend/route.ts");
  const groupRecommend = read("app/api/preliminary-survey-v2/group-recommend/route.ts");
  const groupConfirm = read("app/api/preliminary-survey-v2/group-confirm/route.ts");
  assert.match(recommend, /isPreliminarySurveyV2AutomationEnabled/);
  assert.match(groupRecommend, /isPreliminarySurveyV2AutomationEnabled/);
  assert.match(groupConfirm, /isPreliminarySurveyV2AutomationEnabled/);
});

// ===== V2 정책 OFF 게이트 유지 =====
test("V2 자동추천 정책 게이트는 유지된다", () => {
  assert.match(policy, /if \(!policy\.enabled\) return false/);
  assert.match(businessesRoute, /isPreliminarySurveyV2AutomationEnabled/);
  assert.match(businessesRoute, /loadV2AutomationPolicy/);
});

test("측정대상 GET 응답의 V2 plan 조회(읽기)는 유지된다", () => {
  assert.match(businessesRoute, /preliminary_survey_v2_plan/);
  assert.match(businessesRoute, /preliminary_survey_v2_plans/);
});

// ===== 저장 경로가 V2 실패에 의존하지 않음 =====
test("저장 경로에 V2 plan 생성/추천 실패로 저장이 실패하는 경로가 없다", () => {
  assert.doesNotMatch(businessesRoute, /V2_PLAN_SAVE_FAILED/);
  assert.doesNotMatch(createRoute, /V2 자동 생성 실패/);
});
