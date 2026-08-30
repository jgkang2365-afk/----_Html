import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isActivePreliminarySurveyTarget } from "../lib/business/target-business-form";

const migration = readFileSync("supabase/migrations/20260830140000_expand_preliminary_survey_v2_target_lifecycle_source.sql", "utf8");
const aliasFix = readFileSync("supabase/migrations/20260830143000_fix_preliminary_survey_v2_lifecycle_helper_plan_alias.sql", "utf8");

test("lifecycle은 전체 target 계획 원천 변경만 journal 전 current V2 safe-delete로 정리한다", () => {
  for (const column of ["measurement_date", "measurement_end_date", "daily_staff", "measurer_id", "collaborators", "business_type", "process_changed", "is_registered", "address"]) {
    assert.match(migration, new RegExp(`UPDATE OF[^;]*${column}`, "s"));
    assert.match(migration, new RegExp(`NEW\\.${column} IS NOT DISTINCT FROM OLD\\.${column}`));
  }
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.invalidate_preliminary_survey_v2_current_plan_before_journal/);
  assert.match(migration, /is_preliminary_survey_v2_true_confirmed\(p_target_id\)/);
  assert.match(migration, /delete_preliminary_survey_v2_plan_and_rebalance_assignments\(p_target_id, false, NULL\)/);
  assert.match(migration, /PERFORM public\.invalidate_preliminary_survey_v2_current_plan_before_journal\(NEW\.id\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.invalidate_preliminary_survey_v2_current_plan_before_journal/);
  assert.match(migration, /lifecycle_invalidated_plan_id/);
  assert.match(migration, /applied_plan_id = NULL/);
  assert.match(migration, /created_plan_id = NULL/);
});

test("applied helper의 plan_id shadowing은 forward migration에서 alias로 해소한다", () => {
  assert.match(aliasFix, /v_plan_id uuid/);
  assert.match(aliasFix, /WHERE assignment\.plan_id = v_plan_id/);
  assert.match(aliasFix, /WHERE reconciliation\.applied_plan_id = v_plan_id/);
  assert.doesNotMatch(aliasFix, /\bplan_id uuid/);
});

test("H0070처럼 거래종료 target은 제외되고 실시+유효 측정일이면 별도 등록 없이 재등장한다", () => {
  assert.equal(isActivePreliminarySurveyTarget({ measurementDate: "2026-08-27", registrationStatus: "거래종료" }), false);
  assert.equal(isActivePreliminarySurveyTarget({ measurementDate: "2026-08-27", registrationStatus: "실시" }), true);
  assert.equal(isActivePreliminarySurveyTarget({ measurementDate: null, registrationStatus: "실시" }), false);
});
