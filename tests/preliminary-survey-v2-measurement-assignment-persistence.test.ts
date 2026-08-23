import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseMigration = readFileSync(
  "supabase/migrations/20260822153000_add_preliminary_survey_v2_measurement_assignments.sql",
  "utf8",
);
const forwardMigration = readFileSync(
  "supabase/migrations/20260823120000_finalize_preliminary_survey_assignment_approval_groups.sql",
  "utf8",
);
const remedialMigration = readFileSync(
  "supabase/migrations/20260823123000_limit_assignment_approval_groups_to_affected_dates.sql",
  "utf8",
);
const persistenceFixMigration = readFileSync(
  "supabase/migrations/20260823130000_fix_preliminary_survey_assignment_persistence.sql",
  "utf8",
);
const affectedGroupFixMigration = readFileSync(
  "supabase/migrations/20260823133000_fix_preliminary_survey_affected_assignment_groups.sql",
  "utf8",
);
const migration = `${baseMigration}\n${forwardMigration}\n${remedialMigration}\n${persistenceFixMigration}\n${affectedGroupFixMigration}`;
const workbench = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");

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

test("3건 승인은 측정일·측정자·정렬 targetIds 지문으로 보존하고 구성 변경 시 재승인한다", () => {
  const rpc = remedialMigration;

  assert.match(migration, /approval_group_fingerprint text/);
  assert.match(rpc, /string_agg\(target_id::text, ',' ORDER BY target_id\)/);
  assert.match(rpc, /md5\(measurement_date::text \|\| '\|' \|\| assignee_user_id::text/);
  assert.match(rpc, /approved\.approval_group_fingerprint = grouped\.fingerprint/);
  assert.match(rpc, /assignment_position = 3/);
  assert.match(rpc, /MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED/);
  assert.match(rpc, /RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED'/);
  assert.match(rpc, /previous_fingerprint = ranked\.fingerprint/);
  assert.match(rpc, /previous_approver/);
  assert.doesNotMatch(rpc, /assignment->>'approval_required'/);
  assert.doesNotMatch(rpc, /40001/);
});

test("4건 이상은 planner와 RPC가 모두 hard block하며 client approval boolean으로 우회할 수 없다", () => {
  const rpc = remedialMigration;

  assert.match(rpc, /assignment_count > 3/);
  assert.match(rpc, /MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED/);
  assert.match(rpc, /proposed_keys AS/);
  assert.match(rpc, /\(existing\.measurement_date, existing\.assignee_user_id\) IN/);
  assert.match(rpc, /SELECT measurement_date, assignee_user_id FROM proposed_keys/);
  assert.match(workbench, /MeasurementAssignmentDailyLimitError/);
  assert.match(workbench, /rpcMessage\.includes\("MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED"\)/);
  assert.doesNotMatch(workbench, /approval_required: assignment\.approvalRequired/);
});

test("저장 전후 영향 그룹 합집합은 3건→2건 stale 승인 메타데이터를 지우고 동일 3건 승인만 보존한다", () => {
  const rpc = remedialMigration;

  assert.match(rpc, /old_affected_keys jsonb/);
  assert.match(rpc, /preliminary-measurement-assignment\|/);
  assert.match(rpc, /잠금 뒤의 현재값을 old key로 고정/);
  assert.match(rpc, /INTO old_affected_keys/);
  assert.match(rpc, /jsonb_array_elements\(old_affected_keys\)/);
  assert.match(rpc, /UNION\s+SELECT DISTINCT assignment\.measurement_date, assignment\.assignee_user_id/);
  assert.match(rpc, /WHEN ranked\.assignment_count <> 3 OR ranked\.assignment_position <> 3 THEN NULL/);
  assert.match(rpc, /WHEN ranked\.previous_fingerprint = ranked\.fingerprint AND ranked\.previous_approver IS NOT NULL/);
});

test("forward-only persistence fix는 plan 식별자 충돌을 제거하고 historical migration을 대체하지 않는다", () => {
  const rpc = persistenceFixMigration;

  assert.match(rpc, /CREATE OR REPLACE FUNCTION public\.persist_preliminary_survey_v2_plan_and_measurement_assignments/);
  assert.match(rpc, /plan_item jsonb/);
  assert.match(rpc, /jsonb_array_elements\(p_plans\) plan_payload/);
  assert.match(rpc, /public\.preliminary_survey_v2_plans target_plan/);
  assert.doesNotMatch(rpc, /\bplan jsonb\b/);
  assert.doesNotMatch(rpc, /jsonb_array_elements\(p_plans\) plan\b/);
  assert.doesNotMatch(rpc, /public\.preliminary_survey_v2_plans plan\b/);
});

test("core upsert는 fingerprint까지 같은 statement에서 갱신해 CHECK-valid 중간 상태를 보장한다", () => {
  const rpc = persistenceFixMigration;

  assert.match(rpc, /prior_approvals AS/);
  assert.match(rpc, /prior_approval\.fingerprint = ranked\.fingerprint/);
  assert.match(rpc, /canonical\.assignment_count = 3 AND canonical\.assignment_position = 3/);
  assert.match(rpc, /approval_group_fingerprint = EXCLUDED\.approval_group_fingerprint/);
  assert.match(rpc, /COALESCE\(canonical\.prior_approved_by_user_id, p_approved_by_user_id\)/);
  assert.match(rpc, /COALESCE\(canonical\.prior_approved_at, CURRENT_TIMESTAMP\)/);
  assert.match(rpc, /assignment_count > 3/);
  assert.match(rpc, /MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED/);
  assert.doesNotMatch(rpc, /assignment_payload->>'approval_required'/);
  assert.doesNotMatch(rpc, /40001/);
});

test("wrapper 사전검증은 old와 proposed 영향 그룹의 최종 상태를 함께 검사한다", () => {
  const rpc = affectedGroupFixMigration;

  assert.match(rpc, /old_affected_keys jsonb/);
  assert.match(rpc, /proposed_keys AS/);
  assert.match(rpc, /affected_keys AS[\s\S]*jsonb_array_elements\(old_affected_keys\)[\s\S]*UNION[\s\S]*SELECT measurement_date, assignee_user_id FROM proposed_keys/);
  assert.match(rpc, /reapplied_targets AS/);
  assert.match(rpc, /JOIN affected_keys USING \(measurement_date, assignee_user_id\)/);
  assert.match(rpc, /final_rows AS[\s\S]*NOT EXISTS[\s\S]*UNION ALL[\s\S]*jsonb_array_elements\(p_assignments\)/);
  assert.match(rpc, /assignment_count > 3/);
  assert.match(rpc, /assignment_count = 3 AND NOT EXISTS/);
  assert.match(rpc, /approved\.approval_group_fingerprint = grouped\.fingerprint/);
  assert.match(rpc, /MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED/);
  assert.match(rpc, /MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED/);
  assert.doesNotMatch(rpc, /assignment_payload->>'approval_required'/);
  assert.doesNotMatch(rpc, /ALTER TABLE[\s\S]*preliminary_survey_v2_assignment_approval_check/);
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
  assert.match(workbench, /persist_preliminary_survey_v2_plan_and_assignment_groups/);
  assert.match(workbench, /p_approve_third_assignment: approveThirdAssignment/);
  assert.match(workbench, /p_approved_by_user_id: approveThirdAssignment \? approvedByUserId : null/);
  assert.doesNotMatch(workbench, /PUBLIC_SAMPLE_CODE_BY_NAME/);
  assert.doesNotMatch(workbench, /measurer_user_id/);
});

test("추천과 Apply 재계산은 동일한 canonical target builder를 사용한다", () => {
  assert.equal((workbench.match(/buildMeasurementAssignmentTargets\(\{/g) ?? []).length, 2);
  assert.match(workbench, /submittedByTargetId[\s\S]*sourceResponsibleUserId/);
  assert.doesNotMatch(workbench, /const assignmentTargets:[\s\S]*businessCode: context\.target\.code, region: context\.target\.region/);
  assert.match(service, /loadV2ManualContext[\s\S]*measurementStaffByDate: measurementStaffByDateFromSource/);
});
