import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addMonthlyRevenueEntries, type MonthlyRevenueValue } from "../lib/dashboard/monthly-revenue";

function emptyMonths() {
  return Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    `${index + 1}월`, { current: 0, previous: 0 },
  ])) as Record<string, MonthlyRevenueValue>;
}

test("월별 매출 추이는 측정비와 기타매출 합계금액을 함께 합산한다", () => {
  const stats = emptyMonths();
  addMonthlyRevenueEntries(stats, [
    { year: 2026, period: "상반기", amount: 100, primaryDate: "2026-01-10", fallbackDate: null },
    { year: 2026, period: "상반기", amount: 25, primaryDate: "2026-01-20", fallbackDate: null },
    { year: 2025, period: "상반기", amount: 40, primaryDate: null, fallbackDate: "2025-02-03T00:00:00Z" },
    { year: 2026, period: "하반기", amount: 999, primaryDate: "2026-01-25", fallbackDate: null },
  ], 2026, 2025, "상반기");

  assert.deepEqual(stats["1월"], { current: 125, previous: 0 });
  assert.deepEqual(stats["2월"], { current: 0, previous: 40 });
});

test("대시보드 API는 other_revenue의 total_amount와 invoice_date를 월별 추이에 사용한다", () => {
  const source = readFileSync("app/api/dashboard/route.ts", "utf8");
  assert.match(source, /from\("other_revenue"\)[\s\S]*?select\("revenue_year, revenue_period, total_amount, invoice_date, created_at"\)/);
  assert.match(source, /amount: item\.total_amount/);
  assert.match(source, /primaryDate: item\.invoice_date/);
});
