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
