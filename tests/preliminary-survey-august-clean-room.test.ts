import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  AUGUST_2026_CLEAN_ROOM_MODE,
  includesAugust2026MeasurementDate,
  isAugust2026MeasurementScope,
} from "../lib/preliminary-survey-v2/transition-mode";

const read = (path: string) => readFileSync(path, "utf8");

test("8월 clean-room은 정확한 측정일 범위와 다일 실제 측정일을 사용한다", () => {
  assert.equal(AUGUST_2026_CLEAN_ROOM_MODE, "2026-08-clean-room");
  assert.equal(isAugust2026MeasurementScope("2026-08-01", "2026-08-31"), true);
  assert.equal(isAugust2026MeasurementScope("2026-08-02", "2026-08-31"), false);
  assert.equal(includesAugust2026MeasurementDate(["2026-07-31", "2026-08-25"]), true);
  assert.equal(includesAugust2026MeasurementDate(["2026-07-31", "2026-09-01"]), false);
});

test("clean-room은 persisted V2와 찐확정 exclusion만 비우고 원천 역할은 유지한다", () => {
  const service = read("lib/preliminary-survey-v2/service.ts");
  assert.match(service, /codes\.length && !augustCleanRoom[\s\S]+?journalQuery/);
  assert.match(service, /options\.ignoreLegacyAssignmentInputs \|\| augustCleanRoom[\s\S]+?preliminary_survey_v2_plans/);
  assert.match(service, /const measurementStaffByDate = options\.ignoreLegacyAssignmentInputs \?/);
  assert.doesNotMatch(service, /const measurementStaffByDate = options\.ignoreLegacyAssignmentInputs \|\| augustCleanRoom/);
  assert.match(service, /loadActualMeasurementBlockedKeys\(supabase, candidateDates, userRows\)/);
});

test("Workbench clean-room은 전체 8월 preview만 만들고 apply와 repair를 차단한다", () => {
  const route = read("app/api/preliminary-survey-v2/workbench/route.ts");
  const ui = read("components/features/PreliminarySurveyV2Plans.tsx");
  assert.match(route, /includesAugust2026MeasurementDate\(explicitMeasurementDates\(target\)\)/);
  assert.match(route, /AUGUST_CLEAN_ROOM_PREVIEW_ONLY/);
  assert.match(route, /augustCleanRoom[\s\S]+?preliminary_survey_v2_measurement_assignments/);
  assert.match(ui, /cleanRoom \? null : await fetch\("\/api\/preliminary-survey-v2\/confirmed-document-repair"/);
  assert.match(ui, /draftTransitionMode != null[\s\S]+?추천안 적용/);
});

test("8월 READ-ONLY 계산은 고정 역할 fixture를 주입하지 않고 과거 비교를 분리한다", () => {
  const script = read("scripts/preliminary-survey-august-readonly.ts");
  assert.match(script, /calculationMode: AUGUST_2026_CLEAN_ROOM_MODE/);
  assert.doesNotMatch(script, /august31Fixture|fixedResults|FIXTURE_RECALCULATION_FAILED/);
  assert.match(script, /cleanRoomResult:[\s\S]+?historicalComparison:/);
});

test("다일 공시료 목록 셀은 날짜 문자열을 병합하지 않고 상세에서만 전체를 보여 준다", () => {
  const route = read("app/api/preliminary-survey-v2/workbench/route.ts");
  const ui = read("components/features/PreliminarySurveyV2Plans.tsx");
  assert.match(route, /날짜별 \$\{measurementAssignments\.length\}건 · 상세 확인/);
  assert.doesNotMatch(route, /assignment\.measurementDate\} \$\{assignment\.userName/);
  assert.match(ui, /selected\.measurementAssignments\?\.map/);
});
