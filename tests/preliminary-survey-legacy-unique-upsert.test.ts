import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { isLegacySurveyUniqueConflict, LEGACY_SURVEY_UNIQUE_CONSTRAINT } from "../lib/business/survey-duplicate";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260819_preliminary_survey_unique.sql");
const businessesRoute = read("app/api/businesses/route.ts");
const surveyRoute = read("app/api/survey/route.ts");
const excelSync = read("lib/sync/excel-sync.ts");

// ===== UNIQUE migration =====
test("UNIQUE migration은 schema drift(year/period/notes)를 idempotent로 보정한다", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS year integer/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS period text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS notes text/);
});

test("UNIQUE migration은 (code,year,period,measurement_date) constraint를 조건부로 생성한다", () => {
  assert.match(migration, /ADD CONSTRAINT uq_preliminary_survey_code_year_period_measurement_date/);
  assert.match(migration, /UNIQUE \(code, year, period, measurement_date\)/);
  // 조건부 생성: pg_constraint 존재 여부 확인 후 없을 때만 생성
  assert.match(migration, /pg_constraint/);
  assert.match(migration, /IF NOT constraint_exists/);
});

test("UNIQUE migration은 정상 constraint를 DROP하지 않는다", () => {
  assert.doesNotMatch(migration, /DROP CONSTRAINT IF EXISTS uq_preliminary_survey_code_year_period_measurement_date/);
  assert.doesNotMatch(migration, /DROP CONSTRAINT/);
});

test("UNIQUE migration은 destructive DDL을 포함하지 않는다", () => {
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  assert.doesNotMatch(migration, /ALTER COLUMN.*DROP NOT NULL/);
});

test("UNIQUE migration은 동일 이름 UNIQUE가 아니면 예외를 던진다", () => {
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /contype = 'u'/);
});

// ===== 23505 판정 helper (실제 단위 동작 검증) =====
test("helper: 이번 legacy UNIQUE constraint 충돌만 true로 판정한다", () => {
  assert.equal(isLegacySurveyUniqueConflict({
    code: "23505",
    message: `duplicate key value violates unique constraint "${LEGACY_SURVEY_UNIQUE_CONSTRAINT}"`,
  }), true);
  // 실제 Postgres 오류: constraint 이름은 message에, 상세는 details에 온다.
  assert.equal(isLegacySurveyUniqueConflict({
    code: "23505",
    message: `duplicate key value violates unique constraint "${LEGACY_SURVEY_UNIQUE_CONSTRAINT}"`,
    details: `Key (code, year, period, measurement_date)=(H9999,2026,하반기,2026-08-01) already exists.`,
  }), true);
});

test("helper: 다른 UNIQUE constraint 충돌(23505)은 false다", () => {
  assert.equal(isLegacySurveyUniqueConflict({
    code: "23505",
    message: 'duplicate key value violates unique constraint "some_other_unique_constraint"',
  }), false);
  assert.equal(isLegacySurveyUniqueConflict({
    code: "23505",
    message: "duplicate key value violates unique constraint",
    details: "Key (id)=(1) already exists.",
  }), false);
});

test("helper: 23505가 아니거나 객체가 아니면 false다", () => {
  assert.equal(isLegacySurveyUniqueConflict({ code: "42P01", message: "table not found" }), false);
  assert.equal(isLegacySurveyUniqueConflict(null), false);
  assert.equal(isLegacySurveyUniqueConflict(undefined), false);
  assert.equal(isLegacySurveyUniqueConflict("23505"), false);
});

// ===== Integrated Sync UPSERT =====
test("Integrated Sync는 (code,year,period,measurement_date) onConflict UPSERT를 사용한다", () => {
  assert.match(businessesRoute, /onConflict: "code,year,period,measurement_date"/);
  assert.match(businessesRoute, /\.upsert\(/);
});

test("Integrated Sync는 기존 행 UPDATE 시 수동 예비조사 정보를 보존한다 (관리 필드만 갱신)", () => {
  const updateBlock = businessesRoute.match(/기존 행: Integrated Sync 관리 필드만 UPDATE[\s\S]{0,400}/);
  assert.ok(updateBlock, "기존 행 UPDATE 보존 주석 블록이 존재해야 함");
  const payload = updateBlock[0];
  assert.doesNotMatch(payload, /preliminary_surveyor/);
  assert.doesNotMatch(payload, /survey_code/);
  assert.doesNotMatch(payload, /google_event_id/);
});

test("Integrated Sync는 이번 legacy UNIQUE 충돌일 때만 race 처리를 수행한다", () => {
  assert.match(businessesRoute, /isLegacySurveyUniqueConflict/);
  // 다른 23505는 throw 처리 (일반 오류 전달)
  assert.match(businessesRoute, /} else if \(insertError\) \{\s*throw insertError;/);
});

// ===== Survey POST 중복 방어 =====
test("Survey POST는 동일 (code,year,period,measurement_date) 존재 시 409로 거부한다", () => {
  assert.match(surveyRoute, /같은 사업장·년도·주기·측정일의 예비조사가 이미 등록되어 있습니다/);
  assert.match(surveyRoute, /status: 409/);
  assert.match(surveyRoute, /\.eq\("measurement_date", measurement_date\)/);
});

test("Survey POST는 이번 legacy UNIQUE 충돌일 때만 409를 반환한다", () => {
  assert.match(surveyRoute, /isLegacySurveyUniqueConflict/);
  // 다른 23505는 일반 서버 오류(500)로 전달
  assert.doesNotMatch(surveyRoute, /error\.code === "23505"/);
  assert.match(surveyRoute, /예비조사 등록 중 오류가 발생했습니다/);
});

// ===== excel-sync conflict key =====
test("excel-sync는 measurement_date가 있는 행을 새 UNIQUE 키로 upsert한다", () => {
  assert.match(excelSync, /onConflict: "code,year,period,measurement_date"/);
  assert.match(excelSync, /measurement_date: row\.measurement_date \?\? null/);
});

test("excel-sync는 measurement_date 없는 행을 UPDATE만 수행한다 (신규 INSERT 금지)", () => {
  assert.match(excelSync, /측정일이 없는 행/);
  assert.match(excelSync, /UPDATE만 수행/);
  const surveyUpsertBlock = excelSync.slice(excelSync.indexOf("측정일이 있는 행"));
  assert.match(surveyUpsertBlock, /onConflict: "code,year,period,measurement_date"/);
  assert.doesNotMatch(surveyUpsertBlock, /onConflict: "code,year,period"/);
});

// ===== V2 PAUSE 무영향 =====
test("V2 자동추천 PAUSE 게이트는 이번 변경과 무관하게 유지된다", () => {
  const policy = read("lib/preliminary-survey-v2/policy.ts");
  assert.match(policy, /if \(!policy\.enabled\) return false/);
  // 저장 경로의 V2 자동 호출은 제거됐고(Phase A), 정책 게이트는 V2 전용 API/서비스에 유지된다.
  assert.doesNotMatch(businessesRoute, /ensureV2PlanForTarget/);
  assert.match(businessesRoute, /isPreliminarySurveyV2AutomationEnabled/);
  const service = read("lib/preliminary-survey-v2/service.ts");
  assert.match(service, /if \(!isPreliminarySurveyV2AutomationEnabled\(policy\)\)/);
});
