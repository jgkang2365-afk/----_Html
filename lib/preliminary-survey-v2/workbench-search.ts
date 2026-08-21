export interface WorkbenchSearchRow {
  code?: string | null;
  businessName?: string | null;
}

function normalizedSearchValue(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR")
    : "";
}

/**
 * 쉼표 또는 줄바꿈으로 입력한 작업대 검색어를 정규화한다.
 * 빈 검색어와 같은 검색어의 중복은 제거하되, 입력 순서는 유지한다.
 */
export function parseWorkbenchSearchTerms(value: unknown): string[] {
  if (typeof value !== "string") return [];

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const rawTerm of value.split(/[\n,]+/)) {
    const term = normalizedSearchValue(rawTerm);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

/** 코드 또는 사업장명 중 하나가 검색어와 정확히 또는 부분 일치하면 true를 반환한다. */
export function matchesWorkbenchSearchTerm(row: WorkbenchSearchRow, term: unknown): boolean {
  const normalizedTerm = normalizedSearchValue(term);
  if (!normalizedTerm) return false;

  const code = normalizedSearchValue(row.code);
  const businessName = normalizedSearchValue(row.businessName);
  return code === normalizedTerm || code.includes(normalizedTerm)
    || businessName === normalizedTerm || businessName.includes(normalizedTerm);
}

/** 여러 검색어는 OR 조건으로 적용하며, 유효한 검색어가 없으면 모든 행을 포함한다. */
export function matchesWorkbenchSearch(row: WorkbenchSearchRow, search: unknown): boolean {
  const terms = Array.isArray(search)
    ? parseWorkbenchSearchTerms(search.filter((term): term is string => typeof term === "string").join(","))
    : parseWorkbenchSearchTerms(search);
  return terms.length === 0 || terms.some((term) => matchesWorkbenchSearchTerm(row, term));
}
