import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fix = readFileSync("supabase/migrations/20260815092000_fix_v2_stale_source_sqlstate.sql", "utf8");

// migration에 40001이 더 이상 존재하지 않음
test("새 migration에 SQLSTATE 40001이 존재하지 않는다", () => {
  assert.doesNotMatch(fix, /40001/);
});

// 단건 stale source -> 22023 + V2_PLAN_SOURCE_CHANGED
test("단건 RPC stale source는 22023 + V2_PLAN_SOURCE_CHANGED를 사용한다", () => {
  assert.match(fix, /RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_PLAN_SOURCE_CHANGED';/);
});

// batch stale source -> 22023 + V2_PLAN_SOURCE_CHANGED_AT_<idx>
test("batch RPC stale source는 22023 + V2_PLAN_SOURCE_CHANGED_AT_를 사용한다", () => {
  assert.match(fix, /RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_PLAN_SOURCE_CHANGED_AT_' \|\| v_idx::text;/);
});

// classification mismatch는 기존 22023 유지
test("분류 mismatch는 기존 22023을 그대로 유지한다", () => {
  assert.match(fix, /RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_CLASSIFICATION_SOURCE_MISMATCH';/);
  assert.match(fix, /RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'V2_CLASSIFICATION_SOURCE_MISMATCH_AT_' \|\| v_idx::text;/);
});

// TARGET_NOT_FOUND 기존 동작 유지
test("TARGET_NOT_FOUND는 기존 P0002를 유지한다", () => {
  assert.match(fix, /RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND';/);
  assert.match(fix, /RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND_AT_' \|\| v_idx::text;/);
});

// atomic batch 구조 유지 (쓰기 전 검증, upsert)
test("atomic batch 구조(쓰기 전 검증 + upsert)를 유지한다", () => {
  const batchStart = fix.indexOf("persist_preliminary_survey_v2_plan_batch");
  const firstInsert = fix.indexOf("INSERT INTO public.preliminary_survey_v2_plans", batchStart);
  for (const v of ["INVALID_V2_PLAN_PAYLOAD_AT_", "V2_PLAN_TARGET_ID_MISSING_AT_", "TARGET_NOT_FOUND_AT_", "V2_PLAN_SOURCE_CHANGED_AT_", "V2_CLASSIFICATION_SOURCE_MISMATCH_AT_"]) {
    const idx = fix.indexOf(v);
    assert.ok(idx !== -1 && idx < firstInsert, `${v} must appear before first INSERT`);
  }
  assert.ok((fix.match(/jsonb_array_elements\(p_plans\)/g) ?? []).length >= 2);
  assert.match(fix, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
});

// 권한 REVOKE/GRANT 유지
test("권한 REVOKE(PUBLIC, anon, authenticated)와 service_role GRANT를 유지한다", () => {
  assert.match(fix, /REVOKE ALL ON FUNCTION public\.persist_preliminary_survey_v2_plan_batch\(jsonb\) FROM PUBLIC, anon, authenticated/);
  assert.match(fix, /GRANT EXECUTE ON FUNCTION public\.persist_preliminary_survey_v2_plan_batch\(jsonb\) TO service_role/);
  assert.match(fix, /REVOKE ALL ON FUNCTION public\.persist_preliminary_survey_v2_plan\([\s\S]*?\) FROM PUBLIC, anon, authenticated/);
  assert.match(fix, /GRANT EXECUTE ON FUNCTION public\.persist_preliminary_survey_v2_plan\([\s\S]*?\) TO service_role/);
  assert.match(fix, /REVOKE ALL ON FUNCTION public\.v2_classify_rule_type\(public\.measurement_target_business\) FROM PUBLIC, anon, authenticated/);
  assert.match(fix, /GRANT EXECUTE ON FUNCTION public\.v2_classify_rule_type\(public\.measurement_target_business\) TO service_role/);
});

// TEXT source 비교 유지 (cast 없음)
test("TEXT source 비교를 유지한다 (measurement_date 비교에 ::date 없음)", () => {
  assert.match(fix, /IF target_row\.measurement_date IS DISTINCT FROM p_source_measurement_date/);
  assert.match(fix, /IF target_row\.measurement_date IS DISTINCT FROM \(plan->>'source_measurement_date'\)\r?\n\s+OR target_row\.measurer_id IS DISTINCT FROM \(plan->>'source_responsible_user_id'\)::integer THEN/);
  assert.doesNotMatch(fix, /IS DISTINCT FROM \(plan->>'source_measurement_date'\)::date/);
  assert.doesNotMatch(fix, /IS DISTINCT FROM p_source_measurement_date::date/);
});

// old date signature 재생성 금지
test("기존 date signature를 재생성하지 않는다 (단건 RPC는 text signature 유지)", () => {
  assert.match(fix, /p_source_measurement_date text,/);
  assert.doesNotMatch(fix, /DROP FUNCTION IF EXISTS public\.persist_preliminary_survey_v2_plan/);
  assert.doesNotMatch(fix, /bigint, date, integer, integer, jsonb, jsonb, text, text, date, integer, text, text, jsonb, jsonb, jsonb/);
});

// 기존 적용 migration은 수정하지 않는다
test("기존 migration 파일을 수정하지 않고 별도 후속 파일로 존재한다", () => {
  const prev = readFileSync("supabase/migrations/20260815091000_fix_v2_persist_source_type_and_permissions.sql", "utf8");
  assert.match(prev, /ERRCODE = '40001'/); // 기존 파일에는 여전히 40001이 남아있어야 함(수정 금지)
  assert.notEqual(fix, prev);
});
