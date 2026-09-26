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
