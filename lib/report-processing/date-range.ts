import { isValidDateString } from '@/lib/utils/date-validator';

export type ReportProcessingDateRange = { from: string | null; to: string | null };
export type ReportProcessingDateRangeResult =
  | { ok: true; range: ReportProcessingDateRange }
  | { ok: false; error: string };

/** API와 조회 규칙이 같은 달력 날짜 범위를 사용하도록 서버 경계에서 정규화한다. */
export function normalizeReportProcessingDateRange(
  from: string | null,
  to: string | null,
  label: string,
): ReportProcessingDateRangeResult {
  if (!from && !to) return { ok: true, range: { from: null, to: null } };
  if (!from) return { ok: false, error: `${label} 시작일을 입력해주세요.` };
  const normalizedTo = to || from;
  if (!isValidDateString(from) || !isValidDateString(normalizedTo)) {
    return { ok: false, error: `${label} 형식을 확인해주세요.` };
  }
  if (from > normalizedTo) return { ok: false, error: `${label} 시작일은 종료일보다 늦을 수 없습니다.` };
  return { ok: true, range: { from, to: normalizedTo } };
}
