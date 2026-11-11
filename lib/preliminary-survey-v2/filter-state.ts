import {
  currentDateInKst,
  measurementRangeFromReference,
  type MeasurementRangeUnit,
} from "./recommendation-range";

export interface PlanFilterState {
  year: number;
  period: string;
  statusFilter: string;
  kindFilter: string;
  measurementBaseDate: string;
  measurementRangeUnit: MeasurementRangeUnit;
  measurementDateFrom: string;
  measurementDateTo: string;
  searchQuery: string;
}

export interface ListFilterState extends PlanFilterState {
  preliminaryDateFilter: string;
  methodFilter: string;
}

export function createDefaultPreliminarySurveyFilters(referenceDate = currentDateInKst()): {
  plan: PlanFilterState;
  list: ListFilterState;
} {
  const range = measurementRangeFromReference(referenceDate, "day");
  const plan: PlanFilterState = {
    year: Number(referenceDate.slice(0, 4)),
    period: "",
    statusFilter: "",
    kindFilter: "",
    measurementBaseDate: referenceDate,
    measurementRangeUnit: "day",
    measurementDateFrom: range.startDate,
    measurementDateTo: range.endDate,
    searchQuery: "",
  };
  return {
    plan,
    list: {
      ...plan,
      preliminaryDateFilter: "",
      methodFilter: "",
    },
  };
}

/** 검색 초기화에서는 기준일 제한을 해제하며, 최초 진입의 오늘 날짜 기본값은 유지한다. */
export function createResetPreliminarySurveyFilters(referenceDate = currentDateInKst()): {
  plan: PlanFilterState;
  list: ListFilterState;
} {
  const defaults = createDefaultPreliminarySurveyFilters(referenceDate);
  const withoutDate = {
    measurementBaseDate: "",
    measurementDateFrom: "",
    measurementDateTo: "",
  };
  return {
    plan: { ...defaults.plan, ...withoutDate },
    list: { ...defaults.list, ...withoutDate },
  };
}
