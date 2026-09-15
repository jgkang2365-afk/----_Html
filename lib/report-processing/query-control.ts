export type ReportProcessingQueryFilters = {
  year: string;
  period: string;
  measurementDateFrom: string;
  measurementDateTo: string;
  k2bReceiptDateFrom: string;
  k2bReceiptDateTo: string;
  search: string;
};

export type ReportProcessingDateRangeInputState = {
  from: string;
  to: string;
  toTouched: boolean;
};

/** 저장된 범위는 값만 복원한다. 동일일은 자동 종료일 상태, 그 외는 사용자 지정 상태다. */
export function restoreReportProcessingDateRangeInputState(from: string, to: string): ReportProcessingDateRangeInputState {
  return { from, to, toTouched: from !== to };
}

/** 시작일을 비우면 그룹을 초기화하고, 자동 종료일 상태에서만 종료일을 함께 갱신한다. */
export function changeReportProcessingDateRangeStart(
  state: ReportProcessingDateRangeInputState,
  from: string,
): ReportProcessingDateRangeInputState {
  if (!from) return { from: '', to: '', toTouched: false };
  return { from, to: state.toTouched ? state.to : from, toTouched: state.toTouched };
}

/** 종료일을 비우는 것도 사용자 의도이므로 이후 시작일 변경에서 자동으로 되살리지 않는다. */
export function changeReportProcessingDateRangeEnd(
  state: ReportProcessingDateRangeInputState,
  to: string,
): ReportProcessingDateRangeInputState {
  return { ...state, to, toTouched: true };
}

/** 저장된 필터 복원 뒤 최초 한 번만 자동 조회하고, 이후 필터 입력은 명시적 검색까지 유지한다. */
export function shouldRunInitialReportProcessingQuery(filtersReady: boolean, initialQueryDone: boolean): boolean {
  return filtersReady && !initialQueryDone;
}

export function clearReportProcessingSearchFilters<T extends ReportProcessingQueryFilters>(filters: T): T {
  return {
    ...filters,
    measurementDateFrom: "",
    measurementDateTo: "",
    k2bReceiptDateFrom: "",
    k2bReceiptDateTo: "",
    search: "",
  };
}

export function reportProcessingDateRangeError(from: string, to: string, label: string): string | null {
  if (!from && !to) return null;
  if (!from) return `${label} 시작일을 입력해주세요.`;
  if (from > (to || from)) return `${label} 시작일은 종료일보다 늦을 수 없습니다.`;
  return null;
}
