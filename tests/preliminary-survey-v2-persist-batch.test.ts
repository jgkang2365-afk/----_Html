import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyMeasurementJournalBusiness, type MeasurementJournalClassificationRow } from "../lib/preliminary-survey-v2/classification";

const migration = readFileSync("supabase/migrations/20260815090000_unify_v2_persist_classification_and_batch.sql", "utf8");
const oldMigration = readFileSync("supabase/migrations/20260808_add_preliminary_survey_v2.sql", "utf8");
const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
const manualRoute = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");

const journal = (note: unknown, overrides: Partial<MeasurementJournalClassificationRow> = {}): MeasurementJournalClassificationRow => ({
  id: 1,
  code: "H0001",
  measurement_year: 2026,
  measurement_period: "하반기",
  note,
  updated_at: "2026-08-01T00:00:00Z",
  ...overrides,
});
const classificationTarget = { code: "H0001", year: 2026, period: "하반기" };

// ---- 1. 분류 규칙 통일 (TS classification.ts = authoritative) ----
test("H0518 유형: business_type=first_measurement + journal null → new (target_business_type)", () => {
  const result = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: "first_measurement",
    preliminary_survey_rule_type: "existing",
  }, [journal(null)]);
  assert.equal(result.kind, "new");
  assert.equal(result.source, "target_business_type");
});

test("business_type=existing + journal 신규 token → existing 우선 (journal이 덮어쓰지 않음)", () => {
  const result = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: "existing",
    preliminary_survey_rule_type: "general_new",
  }, [journal("최초실시")]);
  assert.equal(result.kind, "existing");
  assert.equal(result.source, "target_business_type");
});

test("business_type null + journal 신규 → new (legacy_journal)", () => {
  const result = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: null,
    preliminary_survey_rule_type: "existing",
  }, [journal("신규")]);
  assert.equal(result.kind, "new");
  assert.equal(result.source, "legacy_journal");
});

test("business_type null + journal 없음 + legacy rule → legacy fallback", () => {
  const result = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: null,
    preliminary_survey_rule_type: "other_org_new",
  }, []);
  assert.equal(result.kind, "new");
  assert.equal(result.source, "legacy_rule_type");
});

test("business_type null + journal 없음 + legacy rule 없음 → existing (안전 기본값)", () => {
  const result = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: null,
    preliminary_survey_rule_type: null,
  }, []);
  assert.equal(result.kind, "existing");
});

test("business_type null + journal existing note + legacy rule general_new → journal 우선(existing)", () => {
  const result = classifyMeasurementJournalBusiness({
    ...classificationTarget,
    business_type: null,
    preliminary_survey_rule_type: "general_new",
  }, [journal("공정 변경")]);
  assert.equal(result.kind, "existing");
  assert.equal(result.source, "legacy_journal");
});

// ---- 2. migration: helper + 단건 RPC 통일 + batch RPC 구조 ----
test("migration은 business_type 우선 분류 helper를 정의한다", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.v2_classify_rule_type\(p_target public\.measurement_target_business\)/);
  assert.match(migration, /IF p_target\.business_type = 'existing' THEN/);
  assert.match(migration, /IF p_target\.business_type IN \('first_measurement', 'external_new'\) THEN/);
  assert.match(migration, /p_target\.preliminary_survey_rule_type IN \('general_new', 'other_org_new', 'unconfirmed_new'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.v2_classify_rule_type/);
});

test("단건 RPC는 통일 helper를 사용하고 signature/권한을 유지한다", () => {
  assert.match(migration, /journal_rule_type := public\.v2_classify_rule_type\(target_row\)/);
  assert.match(migration, /V2_CLASSIFICATION_SOURCE_MISMATCH/);
  assert.match(migration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.persist_preliminary_survey_v2_plan\(/);
});

test("batch RPC는 jsonb 배열 입력을 하나의 transaction으로 처리한다", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.persist_preliminary_survey_v2_plan_batch\(\s*p_plans jsonb\s*\)/);
  assert.match(migration, /RETURNS SETOF public\.preliminary_survey_v2_plans/);
  assert.match(migration, /SECURITY DEFINER/);
  // Phase 1(검증)과 Phase 2(저장) 모두 배열을 순회
  assert.ok((migration.match(/jsonb_array_elements\(p_plans\)/g) ?? []).length >= 2);
  // ON CONFLICT upsert 유지 → 재실행 시 duplicate 없음
  assert.match(migration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
  // 검증 실패가 저장보다 앞에 온다(쓰기 전 검증)
  const validateIndex = migration.indexOf("V2_CLASSIFICATION_SOURCE_MISMATCH_AT_");
  const insertIndex = migration.indexOf("RETURN QUERY", migration.indexOf("persist_preliminary_survey_v2_plan_batch"));
  assert.ok(validateIndex !== -1 && insertIndex !== -1 && validateIndex < insertIndex);
  // stale source 검증 유지
  assert.match(migration, /V2_PLAN_SOURCE_CHANGED_AT_/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.persist_preliminary_survey_v2_plan_batch\(jsonb\) TO service_role/);
});

test("batch RPC는 아무것도 쓰기 전에 모든 row를 검증하므로 1건 실패 시 0건 저장 구조다", () => {
  // Phase 1 루프의 모든 RAISE가 첫 INSERT보다 앞에 있어야 한다.
  const batchStart = migration.indexOf("persist_preliminary_survey_v2_plan_batch");
  const firstInsert = migration.indexOf("INSERT INTO public.preliminary_survey_v2_plans", batchStart);
  const validates = [
    "INVALID_V2_PLAN_PAYLOAD_AT_",
    "V2_PLAN_TARGET_ID_MISSING_AT_",
    "TARGET_NOT_FOUND_AT_",
    "V2_PLAN_SOURCE_CHANGED_AT_",
    "V2_CLASSIFICATION_SOURCE_MISMATCH_AT_",
  ];
  for (const v of validates) {
    const idx = migration.indexOf(v);
    assert.ok(idx !== -1 && idx < firstInsert, `${v} must appear before first INSERT`);
  }
});

test("기존 단건 RPC는 삭제하지 않고 다른 기능 호환성을 유지한다", () => {
  assert.match(oldMigration, /CREATE OR REPLACE FUNCTION public\.persist_preliminary_survey_v2_plan/);
  assert.match(manualRoute, /rpc\("persist_preliminary_survey_v2_plan"/);
});

// ---- 3. service.ts 회귀: batch persist 사용 + 단건 RPC 제거(자동 경로) ----
test("persistV2Recommendations는 batch RPC를 사용하며 row별 반복 호출을 제거한다", () => {
  assert.match(service, /rpc\("persist_preliminary_survey_v2_plan_batch", \{ p_plans: payload \}\)/);
  assert.doesNotMatch(service, /supabase\.rpc\("persist_preliminary_survey_v2_plan",/);
  assert.match(service, /V2_PLAN_SAVE_FAILED/);
});

test("batch payload는 RPC가 기대하는 키를 모두 포함한다", () => {
  const payloadBlock = service.slice(service.indexOf("const payload = output.results"), service.indexOf("// 전체 결과를 하나의 PostgreSQL transaction"));
  for (const key of [
    "target_id", "recommended_date", "responsible_user_id", "experienced_reviewer_id",
    "participant_user_ids", "participant_names", "status", "plan_origin",
    "source_measurement_date", "source_responsible_user_id", "source_rule_type",
    "survey_method", "recommendation_reason", "route_evidence", "warnings",
  ]) {
    assert.match(payloadBlock, new RegExp(`${key}:`));
  }
});
