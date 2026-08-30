import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkPreliminarySurveyDatePolicy } from "../lib/preliminary-survey-v2/policy-compliance";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("최초실시 -3부터의 후보 밖인 H0525 유형 날짜를 repair 대상으로 표시한다", () => {
  const result = checkPreliminarySurveyDatePolicy({
    measurementDate: "2026-08-25", preliminaryDate: "2026-07-13", businessType: "first_measurement",
  });
  assert.equal(result.compliant, false);
  assert.deepEqual(result.issues, ["OUTSIDE_POLICY_RANGE"]);
  assert.equal(result.workingDaysBefore, 30);
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
  assert.match(migration, /target_plan\.measurement_target_business_id IN \(SELECT target_id FROM affected_targets\)/);
});
