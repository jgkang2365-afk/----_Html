import assert from "node:assert/strict";
import test from "node:test";
import {
  currentDateOnly,
  futureWorkingDaysBefore,
  isWorkingDay,
  workingDayDistance,
  workingDaysBefore,
} from "../lib/preliminary-survey/calendar";

test("오늘 기준은 서버 위치와 무관하게 한국 날짜를 사용한다", () => {
  assert.equal(currentDateOnly(new Date("2026-08-02T15:30:00Z")), "2026-08-03");
});

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

test("30근무일 이전 구간도 유지하되 오늘 이후 날짜만 후보로 만든다", () => {
  const candidates = futureWorkingDaysBefore("2026-10-30", "2026-08-03");
  const thirtieth = candidates.find((candidate) => candidate.workingDaysBefore === 30)!;
  const thirtyFirst = candidates.find((candidate) => candidate.workingDaysBefore === 31)!;

  assert.equal(workingDayDistance(thirtieth.date, "2026-10-30"), 30);
  assert.equal(workingDayDistance(thirtyFirst.date, "2026-10-30"), 31);
  assert.ok(candidates.every((candidate) => candidate.date > "2026-08-03"));
});
