/**
 * Supabase PostgREST may impose a 1,000-row response cap even if a query
 * requests a larger limit. Aggregate queries must fetch all pages, or the
 * totals silently exclude older measurements.
 *
 * Each page query must use deterministic ordering with a unique tie-breaker
 * (measurement_year/revenue_year, period, id) so offsets remain stable.
 */
export const SALES_SUMMARY_PAGE_SIZE = 1000;

export interface SalesSummaryPage<T> {
  data: T[] | null;
  error?: { message?: string | null } | null;
}

export async function fetchCompleteSalesSummaryRows<T extends { id: string | number }>(
  fetchPage: (from: number, to: number) => PromiseLike<SalesSummaryPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const seenIds = new Set<string>();

  for (let from = 0; ; from += SALES_SUMMARY_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + SALES_SUMMARY_PAGE_SIZE - 1);
    if (error) {
      throw new Error(`매출 집계 전체 조회 실패 (${from}행부터): ${error.message || "알 수 없는 오류"}`);
    }
    if (!Array.isArray(data) || data.length > SALES_SUMMARY_PAGE_SIZE) {
      throw new Error(`매출 집계 전체 조회 응답 형식 오류 (${from}행부터)`);
    }

    for (const row of data) {
      if (!row || row.id === null || row.id === undefined) {
        throw new Error(`매출 집계 결과에 식별자가 없습니다 (${from}행부터)`);
      }
      const key = String(row.id);
      if (seenIds.has(key)) {
        throw new Error(`매출 집계 페이지 간 중복된 행이 있습니다 (id=${key})`);
      }
      seenIds.add(key);
      rows.push(row);
    }

    if (data.length < SALES_SUMMARY_PAGE_SIZE) return rows;
  }
}
