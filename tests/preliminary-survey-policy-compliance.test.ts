import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  checkPreliminarySurveyDatePolicy,
  checkPreliminarySurveyMethodPolicy,
} from "../lib/preliminary-survey-v2/policy-compliance";
import { buildThirdAssignmentReview } from "../lib/preliminary-survey-v2/third-assignment-review";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("최초실시 -3부터의 후보 밖인 H0525 유형 날짜를 repair 대상으로 표시한다", () => {
  const result = checkPreliminarySurveyDatePolicy({
    measurementDate: "2026-08-25", preliminaryDate: "2026-07-13", businessType: "first_measurement",
  });
  assert.equal(result.compliant, false);
  assert.deepEqual(result.issues, ["OUTSIDE_POLICY_RANGE"]);
  assert.equal(result.workingDaysBefore, 30);
});

test("H0526 유형 최초실시 유선 계획은 방문 필수 위반으로 표시한다", () => {
  assert.equal(checkPreliminarySurveyMethodPolicy({
    businessType: "first_measurement",
    surveyMethod: "phone",
  }), "POLICY_MISMATCH_FIRST_MEASUREMENT_METHOD");
  assert.equal(checkPreliminarySurveyMethodPolicy({
    businessType: "first_measurement",
    surveyMethod: "field",
  }), null);
});

test("기존업체 -20 우선 범위와 -3 허용 범위를 구분한다", () => {
  const primary = checkPreliminarySurveyDatePolicy({
    measurementDate: "2026-08-28", preliminaryDate: "2026-07-31", businessType: "existing",
  });
  assert.equal(primary.compliant, true);

  const allowedLast = checkPreliminarySurveyDatePolicy({
    measurementDate: "2026-08-28", preliminaryDate: "2026-08-25", businessType: "existing",
  });
  assert.equal(allowedLast.compliant, true);
  assert.equal(allowedLast.workingDaysBefore, 3);
});

test("기존업체 fallback은 범위 오류가 아니라 당시 제약 확인이 필요한 repair 검토 대상으로 남긴다", () => {
  const result = checkPreliminarySurveyDatePolicy({
    measurementDate: "2026-08-28", preliminaryDate: "2026-07-27", businessType: "existing",
  });
  assert.equal(result.compliant, false);
  assert.deepEqual(result.issues, ["FALLBACK_PRIORITY_REVIEW"]);
  assert.equal(result.priorityReviewRequired, true);
});

test("찐확정 날짜 repair와 참여자 원천 repair는 각각 최소 field와 audit을 사용한다", () => {
  const dateRepair = read("supabase/migrations/20260830150000_add_preliminary_survey_uat_policy_repairs.sql");
  const sourceRepair = read("supabase/migrations/20260830152000_add_preliminary_survey_measurement_source_repair.sql");
  const policyRepairRoute = read("app/api/preliminary-survey-v2/policy-repair/route.ts");
  assert.match(dateRepair, /repair_true_confirmed_preliminary_v2_policy_date/);
  assert.match(dateRepair, /repaired_fields = '\["recommended_date"\]'::jsonb/);
  assert.match(dateRepair, /preliminary_survey_v2_policy_repair_audit/);
  assert.match(sourceRepair, /repair_preliminary_survey_measurement_source/);
  assert.match(sourceRepair, /preliminary_survey_v2_measurement_source_repair_audit/);
  assert.doesNotMatch(sourceRepair, /DELETE\s+FROM\s+public\.measurement_journal/i);
  assert.match(policyRepairRoute, /validatePolicyRepairHardRules/);
    assert.match(policyRepairRoute, /validateManualPlanHardRules/);
    assert.match(policyRepairRoute, /loadActualMeasurementBlockedKeys/);
    assert.match(policyRepairRoute, /buildScheduleBlockKeys/);
    assert.match(policyRepairRoute, /routes: createRouteMetrics\(\)/);
    assert.match(policyRepairRoute, /POLICY_DATE_REPAIR_MANUAL_REVIEW/);
    assert.ok(
      policyRepairRoute.indexOf("await validatePolicyRepairHardRules") <
        policyRepairRoute.indexOf('rpc("repair_true_confirmed_preliminary_v2_policy_date"'),
      "hard-rule validation must complete before the repair RPC is invoked",
    );
});

test("측정일지 날짜 필터는 legacy 예비조사 대신 target의 다일 실제 날짜와 lifecycle을 사용한다", () => {
  const source = read("app/api/journal/search/route.ts");
  assert.match(source, /function targetMeasurementDates/);
  assert.match(source, /targetMeasurementDates\(target\)\.includes\(measurementDate\)/);
  assert.match(source, /isActivePreliminarySurveyTarget/);
  assert.match(source, /return !target \|\| target\.activeForCurrentJournalSearch/);
});

test("공시료 반복 코드는 A/AA와 관리자 CCC 예외를 서버 persistence까지 제한한다", () => {
  const migration = read("supabase/migrations/20260830151000_preliminary_survey_repeat_public_sample_codes.sql");
  assert.match(migration, /'A','AA','AAA'/);
  assert.match(migration, /persist_preliminary_survey_v2_plan_and_assignment_groups_base/);
  assert.match(migration, /MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED/);
  assert.match(migration, /MEASUREMENT_ASSIGNMENT_SURVEY_CODE_DUPLICATE/);
  assert.match(migration, /\(assignment\.measurement_date, assignment\.assignee_user_id\) IN/);
  assert.doesNotMatch(migration, /FROM ranked\s+JOIN affected_targets ON affected_targets\.target_id = ranked\.target_id\s+WHERE assignment\.id = ranked\.id/);
  assert.match(migration, /AS assignment_row\(value\)/);
  assert.match(migration, /target_plan\.measurement_target_business_id IN \(SELECT target_id FROM affected_targets\)/);
});

test("CCC 예외와 측정 원천 repair는 관리자 UI·서버 검증·최소 audit 경계를 함께 둔다", () => {
  const workbench = read("app/api/preliminary-survey-v2/workbench/route.ts");
  const plansUi = read("components/features/PreliminarySurveyV2Plans.tsx");
  const sourceRepair = read("app/api/preliminary-survey-v2/measurement-source-repair/route.ts");
  const sourceRepairMigration = read("supabase/migrations/20260830152000_add_preliminary_survey_measurement_source_repair.sql");
  const preservationMigration = read("supabase/migrations/20260830153000_preserve_measurement_source_repair_plans.sql");
  const auditPermissionMigration = read("supabase/migrations/20260830154000_enforce_preliminary_survey_repair_audit_append_only.sql");
  const publicSampleMigration = read("supabase/migrations/20260830151000_preliminary_survey_repeat_public_sample_codes.sql");

  assert.match(plansUi, /관리자 CCC 예외 검토/);
  assert.match(plansUi, /allowAdminThirdAssignment/);
  assert.match(plansUi, /공시료 관리자 예외 기록/);
  assert.match(workbench, /allowAdminThirdAssignment && session\.role !== "관리자"/);
  assert.match(workbench, /canApproveThirdAssignment: session\.role === "관리자"/);
  assert.match(workbench, /approved_by_user_id, approved_at/);
  assert.match(sourceRepair, /export async function GET/);
  assert.match(sourceRepair, /repairParticipants/);
  assert.match(sourceRepair, /repairReportWriter/);
  assert.match(sourceRepairMigration, /p_repair_participants boolean/);
  assert.match(sourceRepairMigration, /p_repair_report_writer boolean/);
  assert.match(sourceRepairMigration, /preliminary_survey_v2_measurement_source_repair_audit/);
  assert.match(sourceRepairMigration, /MEASUREMENT_SOURCE_REPAIR_PLAN_ASSIGNMENT_CHANGED/);
  assert.match(sourceRepairMigration, /'plan_digest'/);
  assert.match(sourceRepairMigration, /'assignment_digest'/);
  assert.match(sourceRepairMigration, /to_jsonb\(plan\)::text/);
  assert.match(sourceRepairMigration, /to_jsonb\(assignment\)::text/);
  assert.match(sourceRepairMigration, /AS participant_name\(value\)/);
  assert.match(preservationMigration, /app\.preliminary_survey_measurement_source_repair/);
  assert.match(preservationMigration, /NEW\.measurement_date IS NOT DISTINCT FROM OLD\.measurement_date/);
  assert.match(preservationMigration, /AFTER DELETE OR UPDATE OF measurement_date, assignee_user_id/);
  assert.match(preservationMigration, /old_measurement_date/);
  assert.match(publicSampleMigration, /max\(assignment\.approved_at\) AS approved_at/);
  assert.match(publicSampleMigration, /previousAssignments/);
  assert.match(publicSampleMigration, /final_groups\.approved_at::text/);
  assert.match(auditPermissionMigration, /REVOKE ALL ON TABLE public\.preliminary_survey_v2_policy_repair_audit FROM service_role/);
  assert.match(auditPermissionMigration, /REVOKE ALL ON TABLE public\.preliminary_survey_v2_measurement_assignment_exception_audit FROM service_role/);
  assert.match(auditPermissionMigration, /REVOKE ALL ON TABLE public\.preliminary_survey_v2_measurement_source_repair_audit FROM service_role/);
  assert.match(auditPermissionMigration, /POLICY_DATE_REPAIR_OUTSIDE_CANDIDATE_RANGE/);
  assert.match(auditPermissionMigration, /POLICY_DATE_REPAIR_USER_UNAVAILABLE/);
  assert.match(auditPermissionMigration, /pg_advisory_xact_lock/);
  assert.match(auditPermissionMigration, /POLICY_DATE_REPAIR_PHONE_CAPACITY_EXCEEDED/);
  assert.match(auditPermissionMigration, /POLICY_DATE_REPAIR_FIELD_ROUTE_MANUAL_REVIEW/);
  assert.match(auditPermissionMigration, /POLICY_DATE_REPAIR_ACTUAL_MEASUREMENT_CONFLICT/);
  assert.match(auditPermissionMigration, /POLICY_DATE_REPAIR_MEASUREMENT_TARGET_CONFLICT/);
  assert.match(auditPermissionMigration, /main_measurer_id/);
  assert.match(auditPermissionMigration, /helper_ids/);
  assert.doesNotMatch(auditPermissionMigration, /measurement_target\.measurer_id = participant_user\.id/);
});

test("날짜별 공시료 수동수정은 권한·찐확정·stale·동시성·그룹 재정규화와 audit 경계를 둔다", () => {
  const migration = read("supabase/migrations/20260831075653_add_preliminary_survey_measurement_assignment_manual_edit.sql");
  const route = read("app/api/preliminary-survey-v2/measurement-assignment/route.ts");
  const workbench = read("app/api/preliminary-survey-v2/workbench/route.ts");
  const ui = read("components/features/PreliminarySurveyV2Plans.tsx");
  assert.match(migration, /preliminary_survey_v2_measurement_assignment_manual_audit/);
  assert.match(migration, /assignment_id uuid REFERENCES[\s\S]+?ON DELETE SET NULL/);
  assert.match(migration, /plan_id uuid REFERENCES[\s\S]+?ON DELETE SET NULL/);
  assert.match(migration, /is_preliminary_survey_v2_true_confirmed/);
  assert.match(migration, /MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /new_group_count >= 4/);
  assert.match(migration, /new_group_count = 3/);
  assert.match(migration, /p_expected_approval_group_fingerprint/);
  assert.match(migration, /p_expected_measurement_date date/);
  assert.match(migration, /preliminary-measurement-assignment\|/);
  assert.doesNotMatch(migration, /preliminary-survey-measurement-assignment\|/);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]+?SELECT \* INTO assignment_row/);
  assert.match(migration, /proposed_group_fingerprint := md5/);
  assert.match(migration, /approval_group_fingerprint = CASE/);
  assert.match(migration, /ranked\.assignment_position = 3/);
  assert.match(migration, /ranked\.assignment_count <> 3 OR ranked\.assignment_position <> 3 THEN NULL/);
  assert.match(migration, /is_preliminary_survey_manager IS TRUE/);
  assert.match(migration, /role = '관리자'/);
  assert.match(migration, /user_schedule_blocks/);
  assert.match(migration, /GRANT EXECUTE[\s\S]+?TO service_role/);
  assert.match(migration, /REVOKE ALL[\s\S]+?PUBLIC, anon, authenticated/);
  assert.match(migration, /repair_true_confirmed_preliminary_v2_policy_method/);
  assert.match(migration, /'\["survey_method"\]'::jsonb/);
  assert.match(migration, /true_confirmed_policy_method_repair/);
  assert.match(migration, /POLICY_METHOD_REPAIR_OUTSIDE_CANDIDATE_RANGE/);
  assert.match(migration, /POLICY_METHOD_REPAIR_PARTICIPANT_INELIGIBLE/);
  assert.match(migration, /POLICY_METHOD_REPAIR_FIELD_ROUTE_MANUAL_REVIEW/);
  assert.match(migration, /LOCK TABLE public\.preliminary_survey_v2_plans IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(route, /canManagePreliminarySurvey/);
  assert.match(route, /if \(session\.role === "관리자"\)/);
  assert.match(route, /admin_override_preliminary_survey_v2_measurement_assignment/);
  assert.match(route, /if \(approveThirdAssignment\)[\s\S]+?공시료 3건 예외는 관리자만 승인/);
  assert.match(route, /update_preliminary_survey_v2_measurement_assignment/);
  assert.match(route, /loadThirdAssignmentReview/);
  assert.match(route, /expectedApprovalGroupFingerprint/);
  assert.match(workbench, /measurementAssignments/);
  assert.match(workbench, /persistedAssignments\.map/);
  assert.match(ui, /실제 측정일별 공시료/);
  assert.match(ui, /같은 측정일의 영향 그룹 코드는 C\/CC\/CCC\/CCCC… 규칙으로 함께 재정규화/);
  assert.match(ui, /review\.items\.map/);
  assert.match(ui, /review\.fingerprint/);
  const policyRepairRoute = read("app/api/preliminary-survey-v2/policy-repair/route.ts");
  assert.match(policyRepairRoute, /action === "apply_method"/);
  assert.match(policyRepairRoute, /survey_method/);
  const augustReadonly = read("scripts/preliminary-survey-august-readonly.ts");
  const workbenchRoute = read("app/api/preliminary-survey-v2/workbench/route.ts");
  assert.match(augustReadonly, /calculationMode: AUGUST_2026_CLEAN_ROOM_MODE/);
  assert.doesNotMatch(augustReadonly, /august31Fixture|FIXTURE_RECALCULATION_FAILED/);
  assert.match(augustReadonly, /firstMeasurementPhone:[\s\S]+?row\.proposed\.method/);
  assert.match(augustReadonly, /firstMeasurementDateOutsidePolicy:[\s\S]+?row\.proposed\.date/);
  assert.match(augustReadonly, /cleanRoomResult:[\s\S]+?historicalComparison:/);
  assert.match(augustReadonly, /currentPolicyMismatch[\s\S]+?FALLBACK_PRIORITY_REVIEW/);
  assert.match(workbenchRoute, /AUGUST_CLEAN_ROOM_PREVIEW_ONLY/);
  assert.match(workbenchRoute, /augustCleanRoom[\s\S]+?preliminary_survey_v2_measurement_assignments/);
  assert.match(ui, /8월 Clean-room/);
});

test("CCC 검토 모델은 C/CC/CCC 전체를 보여 주고 명시 확인 전 승인 적용을 막는다", () => {
  const plansUi = read("components/features/PreliminarySurveyV2Plans.tsx");
  const review = buildThirdAssignmentReview([
    { targetId: 1, code: "H0001", businessName: "가", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 1, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C", approvalRequired: false }] },
    { targetId: 2, code: "H0002", businessName: "나", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 2, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "CC", approvalRequired: false }] },
    { targetId: 3, code: "H0003", businessName: "다", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 3, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "CCC", approvalRequired: true }] },
  ], [], []);

  assert.equal(review.length, 1);
  assert.deepEqual(review[0].targets.map((target) => target.surveyCode), ["C", "CC", "CCC"]);
  assert.deepEqual(review[0].targets.map((target) => target.targetId), [1, 2, 3]);
  assert.match(plansUi, /if \(thirdAssignmentReview\.length > 0 && !thirdAssignmentConfirmed\)/);
  assert.match(plansUi, /let response = await send\(thirdAssignmentConfirmed\)/);
  assert.match(plansUi, /approveThirdAssignment,/);
});

test("CCC 검토 모델은 확정 C/CC와 신규 CCC를 합쳐 표시하고 신규 draft가 같은 대상·날짜를 덮는다", () => {
  const review = buildThirdAssignmentReview([
    { targetId: 3, code: "H0003", businessName: "신규", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 3, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "CCC", approvalRequired: true }] },
  ], [
    { targetId: 1, code: "H0001", businessName: "기존1", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C" },
    { targetId: 2, code: "H0002", businessName: "기존2", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "CC" },
    { targetId: 3, code: "H0003-과거", businessName: "과거값", sourceAddress: "서울 B", measurementDate: "2026-08-25", userId: 9, userName: "다른측정자", surveyCode: "A" },
  ], []);

  assert.equal(review.length, 1);
  assert.deepEqual(review[0].targets.map((target) => [target.targetId, target.surveyCode, target.businessName]), [
    [1, "C", "기존1"], [2, "CC", "기존2"], [3, "CCC", "신규"],
  ]);
});

test("legacy 중복 C/C 또는 F/F도 DB wrapper 순서와 같은 C/CC/CCC, F/FF/FFF 검토 결과로 정규화한다", () => {
  const cReview = buildThirdAssignmentReview([
    { targetId: 30, code: "H0030", businessName: "신규", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 30, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "CCC", approvalRequired: true }] },
  ], [
    { targetId: 10, code: "H0010", businessName: "기존1", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C", baseSurveyCode: "C", createdAt: "2026-08-01T00:00:00Z" },
    { targetId: 20, code: "H0020", businessName: "기존2", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C", baseSurveyCode: "C", createdAt: "2026-08-02T00:00:00Z" },
  ], []);
  assert.deepEqual(cReview[0].targets.map((target) => [target.targetId, target.surveyCode, target.previousSurveyCode]), [
    [10, "C", "C"], [20, "CC", "C"], [30, "CCC", null],
  ]);

  const fReview = buildThirdAssignmentReview([
    { targetId: 30, code: "H0030", businessName: "신규", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 30, measurementDate: "2026-08-25", userId: 8, userName: "측정자F", surveyCode: "FFF", approvalRequired: true }] },
  ], [
    { targetId: 10, code: "H0010", businessName: "기존1", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 8, userName: "측정자F", surveyCode: "F", baseSurveyCode: "F", createdAt: "2026-08-01T00:00:00Z" },
    { targetId: 20, code: "H0020", businessName: "기존2", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 8, userName: "측정자F", surveyCode: "F", baseSurveyCode: "F", createdAt: "2026-08-02T00:00:00Z" },
  ], []);
  assert.deepEqual(fReview[0].targets.map((target) => target.surveyCode), ["F", "FF", "FFF"]);
});

test("기존 3건을 재추천해도 draft 내용은 덮고 저장된 created_at 순서로 CCC 결과를 표시한다", () => {
  const review = buildThirdAssignmentReview([
    { targetId: 10, code: "H0010", businessName: "draft-10", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 10, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C", approvalRequired: false }] },
    { targetId: 20, code: "H0020", businessName: "draft-20", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 20, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "CC", approvalRequired: false }] },
    { targetId: 30, code: "H0030", businessName: "draft-30", sourceAddress: "서울 A", measurementAssignments: [{ targetId: 30, measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "CCC", approvalRequired: true }] },
  ], [
    { targetId: 10, code: "H0010", businessName: "stored-10", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C", baseSurveyCode: "C", createdAt: "2026-08-03T00:00:00Z" },
    { targetId: 20, code: "H0020", businessName: "stored-20", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C", baseSurveyCode: "C", createdAt: "2026-08-01T00:00:00Z" },
    { targetId: 30, code: "H0030", businessName: "stored-30", sourceAddress: "서울 A", measurementDate: "2026-08-25", userId: 7, userName: "측정자", surveyCode: "C", baseSurveyCode: "C", createdAt: "2026-08-02T00:00:00Z" },
  ], []);

  assert.deepEqual(review[0].targets.map((target) => [target.targetId, target.businessName, target.surveyCode]), [
    [20, "draft-20", "C"], [30, "draft-30", "CC"], [10, "draft-10", "CCC"],
  ]);
});
