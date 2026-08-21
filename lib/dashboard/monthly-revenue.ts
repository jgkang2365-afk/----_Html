export interface MonthlyRevenueValue {
  current: number | null;
  previous: number;
}

export interface MonthlyRevenueEntry {
  year: number | string | null | undefined;
  period: string | null | undefined;
  amount: number | string | null | undefined;
  primaryDate: string | null | undefined;
  fallbackDate: string | null | undefined;
}

export interface SameMonthCumulativeRevenue {
  cutoffMonth: number;
  current: number;
  previous: number;
  difference: number;
}

export function calculateSameMonthCumulativeRevenue(
  monthly: Array<{ month: string; current: number | null; previous: number }>,
): SameMonthCumulativeRevenue {
  const cutoffIndex = monthly.reduce(
    (latestIndex, item, index) => item.current !== null ? index : latestIndex,
    -1,
  );

  if (cutoffIndex < 0) {
    return { cutoffMonth: 0, current: 0, previous: 0, difference: 0 };
  }

  const comparableMonths = monthly.slice(0, cutoffIndex + 1);
  const current = comparableMonths.reduce((sum, item) => sum + (item.current ?? 0), 0);
  const previous = comparableMonths.reduce((sum, item) => sum + item.previous, 0);
  const parsedMonth = Number.parseInt(monthly[cutoffIndex].month, 10);

  return {
    cutoffMonth: Number.isNaN(parsedMonth) ? cutoffIndex + 1 : parsedMonth,
    current,
    previous,
    difference: current - previous,
  };
}

export function addMonthlyRevenueEntries(
  monthlyStats: Record<string, MonthlyRevenueValue>,
  entries: MonthlyRevenueEntry[],
  comparisonYear: number,
  prevYear: number,
  targetPeriod: string | null,
) {
  for (const entry of entries) {
    if (targetPeriod && !entry.period?.includes(targetPeriod)) continue;

    const dateValue = entry.primaryDate || entry.fallbackDate;
    if (!dateValue) continue;
    const month = new Date(dateValue).getMonth() + 1;
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;

    const monthValue = monthlyStats[`${month}월`];
    if (!monthValue) continue;
    const amount = parseFloat(entry.amount?.toString() || "0") || 0;
    const year = Number(entry.year);

    if (year === comparisonYear) {
      monthValue.current = (monthValue.current ?? 0) + amount;
    } else if (year === prevYear) {
      monthValue.previous += amount;
    }
  }
}
