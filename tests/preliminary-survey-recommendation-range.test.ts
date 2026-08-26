import assert from "node:assert/strict";
import test from "node:test";
import {
  adjacentMeasurementReferenceDate,
  currentDateInKst,
  dateRangeFromStartDate,
  getAdjacentWeekRangeKst,
  getNextWeekRangeKst,
  measurementRangeFromReference,
  validateMeasurementDateRange,
} from "../lib/preliminary-survey-v2/recommendation-range";

test("시작일 선택은 종료일을 같은 날짜로 초기화한다", () => {
  assert.deepEqual(dateRangeFromStartDate("2026-08-21"), {
    startDate: "2026-08-21",
    endDate: "2026-08-21",
  });
});

test("측정예정일 기간은 두 날짜를 요구하고 종료일 역전을 차단한다", () => {
  assert.equal(validateMeasurementDateRange("", ""), "측정예정일의 시작일과 종료일을 입력해 주세요.");
  assert.equal(validateMeasurementDateRange("2026-08-24", ""), "측정예정일의 시작일과 종료일을 입력해 주세요.");
  assert.equal(validateMeasurementDateRange("2026-08-24", "2026-08-21"), "측정예정 종료일은 시작일보다 빠를 수 없습니다.");
  assert.equal(validateMeasurementDateRange("2026-08-24", "2026-08-24"), null);
  assert.equal(validateMeasurementDateRange("2026-08-24", "2026-08-28"), null);
});

test("기준일이 속한 주 다음 월요일부터 금요일을 반환한다", () => {
  assert.deepEqual(getNextWeekRangeKst("2026-08-21"), {
    startDate: "2026-08-24",
    endDate: "2026-08-28",
  });
  assert.deepEqual(getNextWeekRangeKst("2026-08-19"), {
    startDate: "2026-08-24",
    endDate: "2026-08-28",
  });
});

test("선택한 기준 주에서 이전·이후 주의 월요일~금요일을 대칭 이동한다", () => {
  assert.deepEqual(getAdjacentWeekRangeKst("2026-08-19", -1), {
    startDate: "2026-08-10",
    endDate: "2026-08-14",
  });
  assert.deepEqual(getAdjacentWeekRangeKst("2026-08-19", 1), {
    startDate: "2026-08-24",
    endDate: "2026-08-28",
  });
});

test("기준일이 없으면 now의 KST 날짜를 기준으로 계산한다", () => {
  // UTC 8월 16일 일요일 15:30은 KST 8월 17일 월요일 00:30이다.
  assert.deepEqual(getNextWeekRangeKst(undefined, new Date("2026-08-16T15:30:00.000Z")), {
    startDate: "2026-08-24",
    endDate: "2026-08-28",
  });
});

test("KST 날짜 경계 전에는 전날을 기준으로 계산한다", () => {
  // UTC 8월 16일 일요일 14:59는 KST 8월 16일 일요일 23:59이다.
  assert.deepEqual(getNextWeekRangeKst(undefined, new Date("2026-08-16T14:59:00.000Z")), {
    startDate: "2026-08-17",
    endDate: "2026-08-21",
  });
});

test("일 단위는 하루 범위이며 주말도 건너뛰지 않는다", () => {
  assert.deepEqual(measurementRangeFromReference("2026-08-25", "day"), {
    startDate: "2026-08-25", endDate: "2026-08-25",
  });
  assert.equal(adjacentMeasurementReferenceDate("2026-08-25", "day", -1), "2026-08-24");
  assert.equal(adjacentMeasurementReferenceDate("2026-08-28", "day", 1), "2026-08-29");
});

test("주 단위는 기준 요일과 무관하게 같은 주 월요일부터 금요일이다", () => {
  const expected = { startDate: "2026-08-24", endDate: "2026-08-28" };
  assert.deepEqual(measurementRangeFromReference("2026-08-27", "week"), expected);
  assert.deepEqual(measurementRangeFromReference("2026-08-24", "week"), expected);
  assert.deepEqual(measurementRangeFromReference("2026-08-28", "week"), expected);
  assert.equal(adjacentMeasurementReferenceDate("2026-08-27", "week", -1), "2026-08-20");
  assert.equal(adjacentMeasurementReferenceDate("2026-08-27", "week", 1), "2026-09-03");
});

test("월 단위는 월 전체를 조회하고 이전·다음 달에서 일자를 가능한 만큼 유지한다", () => {
  assert.deepEqual(measurementRangeFromReference("2026-08-25", "month"), {
    startDate: "2026-08-01", endDate: "2026-08-31",
  });
  assert.equal(adjacentMeasurementReferenceDate("2026-08-25", "month", -1), "2026-07-25");
  assert.equal(adjacentMeasurementReferenceDate("2026-08-25", "month", 1), "2026-09-25");
  assert.equal(adjacentMeasurementReferenceDate("2026-03-31", "month", -1), "2026-02-28");
  assert.equal(adjacentMeasurementReferenceDate("2024-03-31", "month", -1), "2024-02-29");
  assert.equal(adjacentMeasurementReferenceDate("2026-12-25", "month", 1), "2027-01-25");
});

test("최초 기준일은 UTC가 아니라 KST 오늘을 사용한다", () => {
  assert.equal(currentDateInKst(new Date("2026-08-25T15:30:00.000Z")), "2026-08-26");
});
