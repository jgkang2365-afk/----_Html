import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyMeasurementJournalBusiness, type MeasurementJournalClassificationRow } from "../lib/preliminary-survey-v2/classification";

const fixMigration = readFileSync("supabase/migrations/20260815091000_fix_v2_persist_source_type_and_permissions.sql", "utf8");
const manualRoute = readFileSync("app/api/preliminary-survey-v2/[targetId]/route.ts", "utf8");
const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");

const journal = (note: unknown): MeasurementJournalClassificationRow => ({
  id: 1, code: "H0001", measurement_year: 2026, measurement_period: "하반기", note, updated_at: "2026-08-01T00:00:00Z",
});

// A. batch RPC: source_measurement_date 비교에 ::date가 없음 (원본 TEXT equality)
test("A: batch RPC는 source_measurement_date를 ::date 없이 TEXT 그대로 비교한다", () => {
  assert.match(
    fixMigration,
    /IF target_row\.measurement_date IS DISTINCT FROM \(plan->>'source_measurement_date'\)\r?\n\s+OR target_row\.measurer_id IS DISTINCT FROM \(plan->>'source_responsible_user_id'\)::integer THEN/,
  );
  // 비교 구간(Phase 1)에는 source_measurement_date에 ::date가 없어야 한다
  const phase1 = fixMigration.slice(fixMigration.indexOf("V2_PLAN_SOURCE_CHANGED_AT_") - 120, fixMigration.indexOf("V2_PLAN_SOURCE_CHANGED_AT_"));
  assert.doesNotMatch(phase1, /source_measurement_date'\)::date/);
  // 저장(INSERT, Phase 2) 시에만 source_measurement_date 컬럼을 위해 ::date cast 사용
  assert.match(fixMigration, /\(plan->>'source_measurement_date'\)::date/);
});

// B. 단건 RPC: p_source_measurement_date가 TEXT 기준
test("B: 단건 RPC의 p_source_measurement_date는 text 타입이고 원본 TEXT로 비교한다", () => {
  assert.match(fixMigration, /p_source_measurement_date text,/);
  assert.match(fixMigration, /IF target_row\.measurement_date IS DISTINCT FROM p_source_measurement_date/);
  // 비교에는 cast가 없고, 저장(VALUES)에만 ::date가 있어야 한다
  const valuesBlock = fixMigration.slice(fixMigration.indexOf("INSERT INTO public.preliminary_survey_v2_plans"));
  assert.match(valuesBlock, /p_source_measurement_date::date/);
});

// C/D. measurement_date가 단일/다중 문자열이어도 원본 TEXT equality 검증 가능
test("C/D: measurement_date 비교는 날짜 cast를 하지 않으므로 단일/다중 문자열 모두 원본 equality로 검증된다", () => {
  // 단일 "2026-08-07" 도, 향후 다중 "2026-08-07,2026-08-08" 도 같은 text=text 비교 대상
  assert.match(fixMigration, /IS DISTINCT FROM \(plan->>'source_measurement_date'\)/);
  assert.match(fixMigration, /IS DISTINCT FROM p_source_measurement_date/);
  // 두 비교 모두 ::date cast가 없는 형태임을 재확인
  assert.doesNotMatch(fixMigration, /IS DISTINCT FROM \(plan->>'source_measurement_date'\)::date/);
  assert.doesNotMatch(fixMigration, /IS DISTINCT FROM p_source_measurement_date::date/);
});

// E. source 불일치 → V2_PLAN_SOURCE_CHANGED
test("E: source_measurement_date 불일치 시 단건/배치 모두 V2_PLAN_SOURCE_CHANGED를 raise한다", () => {
  assert.match(fixMigration, /V2_PLAN_SOURCE_CHANGED/);
  assert.match(fixMigration, /V2_PLAN_SOURCE_CHANGED_AT_/);
  // measurer_id stale 검증도 유지
  assert.match(fixMigration, /source_responsible_user_id/);
});

// F. batch: 한 건 실패 시 전체 0건 저장 구조 유지
test("F: batch는 모든 validation(RAISE)이 INSERT보다 먼저 수행되어 0건 저장 구조를 유지한다", () => {
  const batchStart = fixMigration.indexOf("persist_preliminary_survey_v2_plan_batch");
  const firstInsert = fixMigration.indexOf("INSERT INTO public.preliminary_survey_v2_plans", batchStart);
  for (const v of ["INVALID_V2_PLAN_PAYLOAD_AT_", "V2_PLAN_TARGET_ID_MISSING_AT_", "TARGET_NOT_FOUND_AT_", "V2_PLAN_SOURCE_CHANGED_AT_", "V2_CLASSIFICATION_SOURCE_MISMATCH_AT_"]) {
    const idx = fixMigration.indexOf(v);
    assert.ok(idx !== -1 && idx < firstInsert, `${v} must appear before first INSERT`);
  }
  assert.ok((fixMigration.match(/jsonb_array_elements\(p_plans\)/g) ?? []).length >= 2);
  assert.match(fixMigration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
});

// G. 권한: batch/단건/helper 모두 PUBLIC, anon, authenticated EXECUTE 제거
test("G: batch/단건/helper는 PUBLIC, anon, authenticated에서 REVOKE된다", () => {
  assert.match(fixMigration, /REVOKE ALL ON FUNCTION public\.v2_classify_rule_type\(public\.measurement_target_business\) FROM PUBLIC, anon, authenticated/);
  assert.match(fixMigration, /REVOKE ALL ON FUNCTION public\.persist_preliminary_survey_v2_plan\([\s\S]*?\) FROM PUBLIC, anon, authenticated/);
  assert.match(fixMigration, /REVOKE ALL ON FUNCTION public\.persist_preliminary_survey_v2_plan_batch\(jsonb\) FROM PUBLIC, anon, authenticated/);
  // PUBLIC 전용 revoke(3건)는 존재하지 않아야 한다
  assert.doesNotMatch(fixMigration, /FROM PUBLIC;/) ;
  assert.doesNotMatch(fixMigration, /FROM PUBLIC\n/);
});

// H. 권한: service_role EXECUTE 유지
test("H: batch/단건/helper는 service_role에 EXECUTE가 유지된다", () => {
  assert.match(fixMigration, /GRANT EXECUTE ON FUNCTION public\.v2_classify_rule_type\(public\.measurement_target_business\) TO service_role/);
  assert.match(fixMigration, /GRANT EXECUTE ON FUNCTION public\.persist_preliminary_survey_v2_plan\([\s\S]*?\) TO service_role/);
  assert.match(fixMigration, /GRANT EXECUTE ON FUNCTION public\.persist_preliminary_survey_v2_plan_batch\(jsonb\) TO service_role/);
});

// old date signature 제거 (overload ambiguity 방지)
test("기존 단건 RPC의 date signature를 DROP하여 overload 중복을 방지한다", () => {
  assert.match(fixMigration, /DROP FUNCTION IF EXISTS public\.persist_preliminary_survey_v2_plan\(/);
  assert.match(fixMigration, /bigint, date, integer, integer, jsonb, jsonb, text, text, date, integer, text, text, jsonb, jsonb, jsonb/);
  // 새 signature는 9번째 인자가 text
  assert.match(fixMigration, /bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb/);
});

// 호출부 호환성: [targetId] route / service batch 모두 문자열(source TEXT)을 payload로 전달
test("호출부는 source_measurement_date 문자열을 원자 plan+assignment RPC payload로 전달한다", () => {
  assert.match(manualRoute, /source_measurement_date: target\.measurementDate/);
  assert.match(manualRoute, /rpc\("persist_preliminary_survey_v2_plan_and_assignment_groups"/);
  assert.doesNotMatch(manualRoute, /rpc\("persist_preliminary_survey_v2_plan"/);
  assert.match(service, /source_measurement_date: target\.measurementDate/);
});

// I. H0518 business_type authoritative 분류 유지
test("I: business_type이 authoritative이므로 H0518(first_measurement)은 journal과 무관하게 new이다", () => {
  const result = classifyMeasurementJournalBusiness({
    code: "H0518", year: 2026, period: "하반기",
    business_type: "first_measurement", preliminary_survey_rule_type: "existing",
  }, [journal(null)]);
  assert.equal(result.kind, "new");
  assert.equal(result.source, "target_business_type");
});

// 새 migration은 기존 적용 완료 migration을 수정하지 않는다(파일이 추가된 형태인지)
test("새 migration 파일은 기존 migration과 별도로 존재하며 기존 파일을 덮어쓰지 않는다", () => {
  const old = readFileSync("supabase/migrations/20260815090000_unify_v2_persist_classification_and_batch.sql", "utf8");
  // 기존 파일은 여전히 비교에 ::date가 있는(수정 전) 형태 그대로 보존되어야 한다
  assert.match(old, /IS DISTINCT FROM \(plan->>'source_measurement_date'\)::date/);
  assert.doesNotMatch(fixMigration, /measurement_date'\)::date\n\s+OR target_row/);
});
