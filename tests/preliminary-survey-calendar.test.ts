import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkingDay,
  workingDayDistance,
  workingDaysBefore,
} from "../lib/preliminary-survey/calendar";

test("주말과 대한민국 공휴일을 제외해 30워킹데이 후보를 만든다", () => {
  const candidates = workingDaysBefore("2026-01-12", 30);

  assert.equal(candidates.length, 30);
  assert.deepEqual(candidates.slice(0, 6), [
    { date: "2026-01-09", workingDaysBefore: 1 },
    { date: "2026-01-08", workingDaysBefore: 2 },
    { date: "2026-01-07", workingDaysBefore: 3 },
    { date: "2026-01-06", workingDaysBefore: 4 },
    { date: "2026-01-05", workingDaysBefore: 5 },
    { date: "2026-01-02", workingDaysBefore: 6 },
  ]);
  assert.equal(isWorkingDay("2026-01-01"), false);
  assert.equal(isWorkingDay("2026-01-10"), false);
});

test("정확히 30워킹데이 전은 허용하고 31워킹데이 전은 범위 밖이다", () => {
  const candidates = workingDaysBefore("2026-08-31", 31);

  assert.equal(workingDayDistance(candidates[29].date, "2026-08-31"), 30);
  assert.equal(workingDayDistance(candidates[30].date, "2026-08-31"), 31);
  assert.equal(
    workingDaysBefore("2026-08-31", 30).some(
      (candidate) => candidate.date === candidates[30].date,
    ),
    false,
  );
});
