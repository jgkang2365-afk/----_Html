import assert from "node:assert/strict";
import test from "node:test";
import {
  dateRangeFromStartDate,
  getNextWeekRangeKst,
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
