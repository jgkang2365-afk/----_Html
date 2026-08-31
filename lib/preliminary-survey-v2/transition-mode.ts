export const AUGUST_2026_CLEAN_ROOM_MODE = "2026-08-clean-room" as const;

export type PreliminarySurveyCalculationMode =
  | "normal"
  | typeof AUGUST_2026_CLEAN_ROOM_MODE;

export const AUGUST_2026_MEASUREMENT_DATE_FROM = "2026-08-01";
export const AUGUST_2026_MEASUREMENT_DATE_TO = "2026-08-31";

export function isAugust2026CleanRoomMode(value: unknown): value is typeof AUGUST_2026_CLEAN_ROOM_MODE {
  return value === AUGUST_2026_CLEAN_ROOM_MODE;
}

export function isAugust2026MeasurementScope(from: unknown, to: unknown) {
  return from === AUGUST_2026_MEASUREMENT_DATE_FROM && to === AUGUST_2026_MEASUREMENT_DATE_TO;
}

export function includesAugust2026MeasurementDate(dates: readonly string[]) {
  return dates.some((date) =>
    date >= AUGUST_2026_MEASUREMENT_DATE_FROM && date <= AUGUST_2026_MEASUREMENT_DATE_TO,
  );
}
