import { isReportProcessingTargetActive } from "./measurement-dates";

export const REPORT_PROCESSING_EXCLUDED_BUSINESS_NAME_PATTERN = "%번외%";

type ReportProcessingScopeRow = {
  code?: string | null;
  year?: number | null;
  period?: string | null;
};

type ReportProcessingScopeTarget = ReportProcessingScopeRow & {
  is_registered?: unknown;
};

function reportProcessingScopeKey(row: ReportProcessingScopeRow): string {
  return `${String(row.code ?? "").trim()}-${row.year ?? ""}-${String(row.period ?? "").trim()}`;
}

/** 보고서 처리 목록과 동일하게, target이 있으면 현재 lifecycle(실시)인 행만 남긴다. */
export function selectReportProcessingCodes(
  businesses: ReportProcessingScopeRow[],
  targets: ReportProcessingScopeTarget[],
): string[] {
  const targetsByKey = new Map(targets.map((target) => [reportProcessingScopeKey(target), target]));
  return Array.from(new Set(businesses.flatMap((business) => {
    const code = String(business.code ?? "").trim();
    if (!code) return [];
    const target = targetsByKey.get(reportProcessingScopeKey(business));
    return target && !isReportProcessingTargetActive(target) ? [] : [code];
  })));
}

export function getReportProcessingPeriodForDate(resultDate: string): { year: number; period: "상반기" | "하반기" } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) {
    throw new Error("보고서 처리 기준일은 YYYY-MM-DD 형식이어야 합니다.");
  }
  const year = Number(resultDate.slice(0, 4));
  const month = Number(resultDate.slice(5, 7));
  return { year, period: month <= 6 ? "상반기" : "하반기" };
}
