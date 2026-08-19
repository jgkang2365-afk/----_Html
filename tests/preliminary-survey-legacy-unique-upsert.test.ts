import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

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

test("UNIQUE migration은 (code,year,period,measurement_date) constraint를 생성한다", () => {
  assert.match(migration, /ADD CONSTRAINT uq_preliminary_survey_code_year_period_measurement_date/);
  assert.match(migration, /UNIQUE \(code, year, period, measurement_date\)/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS uq_preliminary_survey_code_year_period_measurement_date/);
});

test("UNIQUE migration은 destructive DDL을 포함하지 않는다", () => {
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  assert.doesNotMatch(migration, /ALTER COLUMN.*DROP NOT NULL/);
});

// ===== Integrated Sync UPSERT =====
test("Integrated Sync는 (code,year,period,measurement_date) onConflict UPSERT를 사용한다", () => {
  assert.match(businessesRoute, /onConflict: "code,year,period,measurement_date"/);
  assert.match(businessesRoute, /\.upsert\(/);
});

test("Integrated Sync는 기존 행 UPDATE 시 수동 예비조사 정보를 보존한다 (관리 필드만 갱신)", () => {
  const updateBlock = businessesRoute.match(/기존 행: Integrated Sync 관리 필드만 UPDATE[\s\S]{0,400}/);
  assert.ok(updateBlock, "기존 행 UPDATE 보존 주석 블록이 존재해야 함");
  // UPDATE payload에 measurement_date/preliminary_surveyor/survey_code/google_event_id가 포함되지 않아야 함
  const payload = updateBlock[0];
  assert.doesNotMatch(payload, /preliminary_surveyor/);
  assert.doesNotMatch(payload, /survey_code/);
  assert.doesNotMatch(payload, /google_event_id/);
});

test("Integrated Sync는 race 시 unique violation(23505)을 처리한다", () => {
  assert.match(businessesRoute, /23505/);
});

// ===== Survey POST 중복 방어 =====
test("Survey POST는 동일 (code,year,period,measurement_date) 존재 시 409로 거부한다", () => {
  assert.match(surveyRoute, /같은 사업장·년도·주기·측정일의 예비조사가 이미 등록되어 있습니다/);
  assert.match(surveyRoute, /status: 409/);
  assert.match(surveyRoute, /\.eq\("measurement_date", measurement_date\)/);
});

test("Survey POST는 UNIQUE 위반(23505) race를 409로 처리한다", () => {
  assert.match(surveyRoute, /error\.code === "23505"/);
});

// ===== excel-sync conflict key =====
test("excel-sync는 measurement_date가 있는 행을 새 UNIQUE 키로 upsert한다", () => {
  assert.match(excelSync, /onConflict: "code,year,period,measurement_date"/);
  assert.match(excelSync, /measurement_date: row\.measurement_date \?\? null/);
});

test("excel-sync는 measurement_date 없는 행을 UPDATE만 수행한다 (신규 INSERT 금지)", () => {
  assert.match(excelSync, /측정일이 없는 행/);
  assert.match(excelSync, /UPDATE만 수행/);
  // preliminary_survey 대상 upsert(측정일 있는 행)는 새 UNIQUE 키를 사용해야 한다.
  const surveyUpsertBlock = excelSync.slice(excelSync.indexOf("측정일이 있는 행"));
  assert.match(surveyUpsertBlock, /onConflict: "code,year,period,measurement_date"/);
  assert.doesNotMatch(surveyUpsertBlock, /onConflict: "code,year,period"/);
});

// ===== V2 PAUSE 무영향 =====
test("V2 자동추천 PAUSE 게이트는 이번 변경과 무관하게 유지된다", () => {
  const policy = read("lib/preliminary-survey-v2/policy.ts");
  assert.match(policy, /if \(!policy\.enabled\) return false/);
  assert.match(businessesRoute, /isPreliminarySurveyV2AutomationEnabled/);
  assert.match(businessesRoute, /ensureV2PlanForTarget/);
});
