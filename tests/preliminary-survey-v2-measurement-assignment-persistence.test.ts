import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260822153000_add_preliminary_survey_v2_measurement_assignments.sql",
  "utf8",
);
const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");

test("날짜별 측정자·공시료 배정은 plan UUID와 날짜 단위의 별도 원천 테이블에 저장한다", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.preliminary_survey_v2_measurement_assignments/);
  assert.match(migration, /plan_id uuid NOT NULL REFERENCES public\.preliminary_survey_v2_plans\(id\)/);
  assert.match(migration, /UNIQUE \(plan_id, measurement_date\)/);
  assert.match(migration, /assignee_user_id integer NOT NULL REFERENCES public\.users\(id\)/);
  assert.match(migration, /approved_by_user_id integer REFERENCES public\.users\(id\)/);
  assert.match(migration, /survey_code IN \('A', 'B', 'C', 'D', 'F', 'G'\)/);
  assert.match(migration, /survey_code_source text NOT NULL DEFAULT 'users\.survey_code'/);
  assert.match(migration, /MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH/);
  assert.match(migration, /validate_preliminary_survey_v2_measurement_assignment/);
});

test("찐확정 guard는 plan과 날짜별 assignment의 INSERT UPDATE DELETE를 모두 막는다", () => {
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON public\.preliminary_survey_v2_plans/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON public\.preliminary_survey_v2_measurement_assignments/);
  assert.match(migration, /is_preliminary_survey_v2_true_confirmed/);
  assert.match(migration, /old_target_id bigint := CASE WHEN TG_OP IN \('UPDATE', 'DELETE'\)/);
  assert.match(migration, /new_target_id bigint := CASE WHEN TG_OP IN \('INSERT', 'UPDATE'\)/);
  assert.match(migration, /public\.is_preliminary_survey_v2_true_confirmed\(old_target_id\)/);
  assert.match(migration, /public\.is_preliminary_survey_v2_true_confirmed\(new_target_id\)/);
  assert.match(migration, /TRUE_CONFIRMED_LOCKED/);
  assert.match(migration, /app\.preliminary_survey_admin_repair/);
  assert.match(migration, /current_user = 'postgres'/);
});

test("plan과 assignment는 하나의 RPC에서 source·승인 검증 후 원자 적용한다", () => {
  assert.match(migration, /persist_preliminary_survey_v2_plan_and_measurement_assignments\(/);
  assert.match(migration, /persist_preliminary_survey_v2_plan_batch_unlocked\(legacy_plans\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /DRAFT_ASSIGNMENT_BASELINE_CHANGED/);
  assert.match(migration, /DRAFT_SOURCE_CONTEXT_CHANGED/);
  assert.match(migration, /LEGACY_PLAN_CREATE_DISABLED/);
  assert.match(migration, /item->>'plan_origin' <> 'manual'/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.preliminary_survey_v2_plans FROM service_role/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.preliminary_survey_v2_plans TO service_role/);
  assert.match(migration, /MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED/);
  assert.match(migration, /PLAN_MEASUREMENT_ASSIGNMENT_REQUIRED/);
  assert.match(migration, /MEASUREMENT_ASSIGNMENT_DATE_MISMATCH/);
  assert.match(migration, /DELETE FROM public\.preliminary_survey_v2_measurement_assignments/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.persist_preliminary_survey_v2_plan_and_measurement_assignments[\s\S]*TO service_role/);
  assert.match(migration, /Rollback\(운영 적용 후 별도 승인\)/);
});

test("workbench apply는 전체 draft fingerprint·서버 재추천을 대조하고 pre-migration 저장을 거부한다", () => {
  assert.match(workbench, /recomputeCanonicalMeasurementAssignments/);
  assert.match(workbench, /canonicalFingerprint/);
  assert.match(workbench, /sameCanonicalWorkbenchDraft/);
  assert.match(workbench, /recommendationScope/);
  assert.match(workbench, /measurementAssignments/);
  assert.match(workbench, /DRAFT_REVIEW_REQUIRED/);
  assert.match(workbench, /MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE/);
  assert.match(workbench, /MEASUREMENT_ASSIGNMENT_SCHEMA_REQUIRED/);
  assert.match(workbench, /persist_preliminary_survey_v2_plan_and_measurement_assignments/);
  assert.match(workbench, /p_approve_third_assignment: approveThirdAssignment/);
  assert.match(workbench, /p_approved_by_user_id: approveThirdAssignment \? approvedByUserId : null/);
  assert.doesNotMatch(workbench, /PUBLIC_SAMPLE_CODE_BY_NAME/);
  assert.doesNotMatch(workbench, /measurer_user_id/);
});
