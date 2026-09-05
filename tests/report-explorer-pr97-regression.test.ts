import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  matchesMeasurementDateRange,
  measurementDatesInRange,
} from "../lib/preliminary-survey-v2/workbench-search";

test("PR #97: daily_staff 날짜는 각 날짜에서만 보이고 범위에서는 중복 없이 정렬된다", () => {
  const dates = ["2026-09-16", "2026-09-14", "2026-09-15", "2026-09-15"];

  assert.equal(matchesMeasurementDateRange(dates, "2026-09-15", "2026-09-15"), true);
  assert.equal(matchesMeasurementDateRange(dates, "2026-09-17", "2026-09-17"), false);
  assert.deepEqual(
    measurementDatesInRange(dates, "2026-09-14", "2026-09-01", "2026-09-30"),
    ["2026-09-14", "2026-09-15", "2026-09-16"],
  );
});

test("PR #97: 범위 경계와 한쪽 경계만 지정한 검색도 모든 일정을 기준으로 판정한다", () => {
  const dates = ["2026-09-14", "2026-09-16"];

  assert.equal(matchesMeasurementDateRange(dates, "2026-09-16", ""), true);
  assert.equal(matchesMeasurementDateRange(dates, "", "2026-09-14"), true);
  assert.equal(matchesMeasurementDateRange(dates, "2026-09-17", ""), false);
  assert.equal(matchesMeasurementDateRange(dates, "", "2026-09-13"), false);
});

test("PR #97: daily_staff가 없으면 대표 측정일 한 건으로 fallback한다", () => {
  assert.deepEqual(
    measurementDatesInRange([], "2026-09-14", "2026-09-14", "2026-09-14"),
    ["2026-09-14"],
  );
  assert.deepEqual(measurementDatesInRange([], null, "", ""), []);
});

test("PR #97: list 모드만 날짜별 표시 문맥을 사용하고 target row를 복제하지 않는다", () => {
  const api = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");

  assert.match(api, /const measurementDays = explicitMeasurementDates\(target\)\.map/);
  assert.match(ui, /mode === ["']list["'] && row\.measurementDates\?\.length/);
  assert.doesNotMatch(api, /flatMap\(.*measurementDays/);
});
