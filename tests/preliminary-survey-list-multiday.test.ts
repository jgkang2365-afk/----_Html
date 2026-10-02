import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { measurementDayFormsFrom } from "../lib/business/measurement-day-form";
import { formatMeasurementParticipantsForDisplay } from "../lib/preliminary-survey-v2/participant-display";
import {
  matchesMeasurementDateRange,
  measurementDatesInRange,
} from "../lib/preliminary-survey-v2/workbench-search";

const h0102Dates = ["2026-09-14", "2026-09-15", "2026-09-16"];

test("H0102 다일 측정은 9/14·9/15·9/16 각각 목록에 포함되고 9/17에는 제외된다", () => {
  for (const date of h0102Dates) {
    assert.equal(matchesMeasurementDateRange(h0102Dates, date, date), true, date);
    assert.deepEqual(measurementDatesInRange(h0102Dates, "2026-09-14", date, date), [date]);
  }
  assert.equal(matchesMeasurementDateRange(h0102Dates, "2026-09-17", "2026-09-17"), false);
  assert.deepEqual(measurementDatesInRange(h0102Dates, "2026-09-14", "2026-09-17", "2026-09-17"), []);
});

test("주·월 범위는 plan row를 복제하지 않고 범위 안 실제 측정일을 정렬·중복 제거한다", () => {
  assert.equal(matchesMeasurementDateRange(h0102Dates, "2026-09-13", "2026-09-19"), true);
  assert.deepEqual(
    measurementDatesInRange(["2026-09-16", "2026-09-14", "2026-09-15", "2026-09-15"], "2026-09-14", "2026-09-01", "2026-09-30"),
    h0102Dates,
  );
});

test("daily_staff 날짜가 없으면 대표 measurement_date 한 건으로 fallback한다", () => {
  assert.equal(matchesMeasurementDateRange("2026-09-14", "2026-09-14", "2026-09-14"), true);
  assert.equal(matchesMeasurementDateRange("2026-09-14", "2026-09-15", "2026-09-15"), false);
  assert.deepEqual(measurementDatesInRange([], "2026-09-14", "2026-09-14", "2026-09-14"), ["2026-09-14"]);
});

test("workbench는 한 target row에 실제 측정일과 날짜별 표시 문맥을 제공하고 list만 이를 사용한다", () => {
  const api = readFileSync("app/api/preliminary-survey-v2/workbench/route.ts", "utf8");
  const ui = readFileSync("components/features/PreliminarySurveyV2Plans.tsx", "utf8");
  assert.match(api, /const measurementDays = explicitMeasurementDates\(target\)\.map\(\(measurementDate\) =>/);
  assert.match(api, /measurementDates: measurementDays\.map\(\(day\) => day\.date\)/);
  assert.match(api, /measurementDays,/);
  assert.match(ui, /mode === "list" && row\.measurementDates\?\.length/);
  assert.match(ui, /measurementDateText\(row\)/);
  assert.match(ui, /measurementDayText\(row, "mainMeasurer"\)/);
  assert.match(ui, /measurementDayText\(row, "measurementParticipants"\)/);
  assert.match(api, /reportWriter: reportWriterForDate\(measurementDate\)/);
  assert.match(api, /reportWriter: reportWriterForDate\(String\(target\.measurement_date/);
});

test("다일 측정은 해당 날짜의 보고서 담당자만 참여자 선두에 표시한다", () => {
  const days = measurementDayFormsFrom({
    measurementDate: "2026-10-13",
    measurerId: 99,
    collaborators: "한기문",
    dailyStaff: [
      { date: "2026-10-13", measurer_id: 13, collaborators: ["김민영", "이주형"] },
      { date: "2026-10-14", measurer_id: 15, collaborators: ["한기문", "김민영"] },
    ],
  });
  const names = new Map([[13, "이주형"], [15, "김민영"]]);
  assert.equal(formatMeasurementParticipantsForDisplay(days[0].collaborators, names.get(days[0].measurerId!)), "이주형 · 김민영");
  assert.equal(formatMeasurementParticipantsForDisplay(days[1].collaborators, names.get(days[1].measurerId!)), "김민영 · 한기문");
});
