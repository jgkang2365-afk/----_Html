export type ReportProcessingQueryFilters = {
  year: string;
  period: string;
  measurementDate: string;
  search: string;
};

/** 저장된 필터 복원 뒤 최초 한 번만 자동 조회하고, 이후 필터 입력은 명시적 검색까지 유지한다. */
export function shouldRunInitialReportProcessingQuery(filtersReady: boolean, initialQueryDone: boolean): boolean {
  return filtersReady && !initialQueryDone;
}

export function clearReportProcessingSearchFilters<T extends ReportProcessingQueryFilters>(filters: T): T {
  return { ...filters, measurementDate: "", search: "" };
}
