import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyMeasurementJournalBusiness,
  type MeasurementJournalClassificationRow,
} from "../lib/preliminary-survey-v2/classification";
import { surveyMethodForKind } from "../lib/preliminary-survey-v2/types";
import { shouldApplyProcessChangedPolicy } from "../lib/preliminary-survey-v2/policy";

const journal = (
  note: unknown,
  period = "하반기",
  year = 2026,
): MeasurementJournalClassificationRow => ({
  id: 1, code: "H0001", measurement_year: year, measurement_period: period,
  note, updated_at: "2026-08-01T00:00:00Z",
});

// A. business_type existing -> first_measurement -> new / field
test("A: business_type existing→first_measurement → new, survey_method=field (journal이 덮지 않음)", () => {
  const before = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: "existing",
  }, [journal("최초실시")]);
  assert.equal(before.kind, "existing");

  const after = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: "first_measurement",
  }, [journal("최초실시")]);
  assert.equal(after.kind, "new");
  assert.equal(after.source, "target_business_type");
  assert.equal(surveyMethodForKind(after.kind), "field");
});

// B. first_measurement -> existing -> existing / phone
test("B: first_measurement→existing → existing, survey_method=phone", () => {
  const after = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: "existing",
  }, [journal("최초실시")]);
  assert.equal(after.kind, "existing");
  assert.equal(after.source, "target_business_type");
  assert.equal(surveyMethodForKind(after.kind), "phone");
});

// C. period 변경 -> 해당 period 일지 기준 분류
test("C: period 변경 시 변경된 period와 정확 일치하는 일지를 사용해 분류한다", () => {
  const rows = [journal("최초실시", "상반기", 2026), journal("공정 변경", "하반기", 2026)];
  const upper = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "상반기", business_type: null,
  }, rows);
  const lower = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: null,
  }, rows);
  assert.equal(upper.kind, "new");
  assert.equal(lower.kind, "existing");
});

// D. year 변경 -> 해당 year 일지 기준 분류
test("D: year 변경 시 변경된 year와 정확 일치하는 일지를 사용해 분류한다", () => {
  const rows = [journal("최초실시", "하반기", 2025), journal("공정 변경", "하반기", 2026)];
  const y2025 = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2025, period: "하반기", business_type: null,
  }, rows);
  const y2026 = classifyMeasurementJournalBusiness({
    code: "H0001", year: 2026, period: "하반기", business_type: null,
  }, rows);
  assert.equal(y2025.kind, "new");
  assert.equal(y2026.kind, "existing");
});

// E. process_changed 변경은 applicability/evidence만 갱신, behavior 변화 없음
test("E: process_changed 변경은 policy applicability만 바꾸고 survey method/배정 behavior를 바꾸지 않는다", () => {
  const policyOn = {
    enabled: true, effectiveStartYear: 2026, effectiveStartPeriod: "하반기",
    effectiveStartMeasurementDate: "2026-08-01",
  };
  const base = { year: 2026, period: "하반기", measurementDate: "2026-08-10", processChanged: false as boolean | null };
  assert.equal(shouldApplyProcessChangedPolicy({ policy: policyOn, target: base }), false);
  assert.equal(shouldApplyProcessChangedPolicy({ policy: policyOn, target: { ...base, processChanged: true } }), true);
  // survey method는 kind에만 의존
  assert.equal(surveyMethodForKind("new"), "field");
  assert.equal(surveyMethodForKind("existing"), "phone");
});

// F/G. 기존 measurer_id / measurement_date 연계 회귀 없음
test("F/G: reconcileV2AfterTargetChange는 기존 measurer_id/measurement_date 분기를 유지한다", () => {
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  assert.match(service, /if \(changes\.responsibleChanged\)/);
  assert.match(service, /if \(changes\.measurementDateChanged\)/);
  assert.match(service, /targetChangeRecommendationPolicy/);
});

// H. 동일 target 중복 생성 없음 (upsert)
test("H: batch persist는 measurement_target_business_id 기준 upsert로 중복을 만들지 않는다", () => {
  const migration = readFileSync("supabase/migrations/20260815092000_fix_v2_stale_source_sqlstate.sql", "utf8");
  assert.match(migration, /ON CONFLICT \(measurement_target_business_id\) DO UPDATE/);
});

// Phase A: businesses PATCH는 더 이상 reconcileV2AfterTargetChange를 호출하지 않는다.
// 저장 경로 결합은 제거됐고, reconcile 서비스 함수 자체의 변경 플래그 수용은 유지된다.
test("businesses PATCH는 reconcileV2AfterTargetChange를 호출하지 않는다 (Phase A 분리)", () => {
  const route = readFileSync("app/api/businesses/route.ts", "utf8");
  assert.doesNotMatch(route, /reconcileV2AfterTargetChange/);
  assert.doesNotMatch(route, /ensureV2PlanForTarget/);
});

test("V2 reconcile 서비스는 business_type/process_changed/period/year 변경 플래그를 수용한다 (함수 유지)", () => {
  const service = readFileSync("lib/preliminary-survey-v2/service.ts", "utf8");
  for (const flag of ["businessTypeChanged", "processChangedChanged", "periodChanged", "yearChanged"]) {
    assert.match(service, new RegExp(`${flag}\\?: boolean`));
  }
  // 분류/기간 변경 시 재계산 분기 존재
  assert.match(service, /changes\.businessTypeChanged \|\|/);
  assert.match(service, /changes\.yearChanged/);
});
