const DAY_MS = 86_400_000;

// 행정기관 공개 달력을 기준으로 검토한 2025~2027년 대한민국 공휴일 snapshot.
const KOREAN_HOLIDAYS = new Set([
  "2025-01-01", "2025-01-28", "2025-01-29", "2025-01-30", "2025-03-01", "2025-03-03",
  "2025-05-05", "2025-05-06", "2025-06-06", "2025-08-15", "2025-10-03", "2025-10-05",
  "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25",
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02",
  "2026-05-05", "2026-05-24", "2026-05-25", "2026-06-03", "2026-06-06", "2026-08-15",
  "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05",
  "2026-10-09", "2026-12-25",
  "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01",
  "2027-05-05", "2027-05-13", "2027-06-06", "2027-08-15", "2027-08-16", "2027-09-14",
  "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-11",
  "2027-12-25", "2027-12-27",
]);

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date) throw new Error("INVALID_DATE");
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function isWorkingDay(value: string): boolean {
  const date = parseDateOnly(value);
  if (!date) return false;
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !KOREAN_HOLIDAYS.has(value);
}

export function workingDaysBefore(measurementDate: string, maximum = 30) {
  if (!parseDateOnly(measurementDate)) return [];
  const result: Array<{ date: string; workingDaysBefore: number }> = [];
  let cursor = measurementDate;
  for (let distance = 1, guard = 0; distance <= maximum && guard < 120; guard += 1) {
    cursor = addCalendarDays(cursor, -1);
    if (!isWorkingDay(cursor)) continue;
    result.push({ date: cursor, workingDaysBefore: distance });
    distance += 1;
  }
  return result;
}

/** @deprecated 업체 유형이 없는 legacy 호출용. 현재 Phase B는 recommendationDatesForBusinessType을 사용한다. */
export function recommendationDates(measurementDate: string) {
  const dates = workingDaysBefore(measurementDate, 30);
  const byDistance = new Map(dates.map((item) => [item.workingDaysBefore, item]));
  return [
    ...Array.from({ length: 11 }, (_, index) => 30 - index),
    ...Array.from({ length: 17 }, (_, index) => 19 - index),
  ].flatMap((distance) => byDistance.get(distance) ?? []);
}

export type PhaseBBusinessType = "existing" | "first_measurement" | "external_new";

/** Phase B: 측정예정일과 업체 유형에서 후보일을 만든다. */
export function recommendationDatesForBusinessType(
  measurementDate: string,
  businessType: PhaseBBusinessType,
  options: { minimumDate?: string } = {},
) {
  const maximum = businessType === "first_measurement" ? 30 : 25;
  const dates = workingDaysBefore(measurementDate, maximum);
  const byDistance = new Map(dates.map((item) => [item.workingDaysBefore, item]));
  const distances = businessType === "first_measurement"
    ? Array.from({ length: 28 }, (_, index) => 3 + index)
    : [
        ...Array.from({ length: 18 }, (_, index) => 20 - index),
        ...Array.from({ length: 5 }, (_, index) => 25 - index),
      ];
  return distances
    .flatMap((distance) => byDistance.get(distance) ?? [])
    .filter((candidate) => !options.minimumDate || candidate.date >= options.minimumDate);
}

export function workingDayDistance(earlier: string, later: string): number | null {
  if (!parseDateOnly(earlier) || !parseDateOnly(later) || earlier >= later) return null;
  let cursor = later;
  let count = 0;
  for (let guard = 0; cursor > earlier && guard < 800; guard += 1) {
    cursor = addCalendarDays(cursor, -1);
    if (isWorkingDay(cursor)) count += 1;
  }
  return cursor === earlier ? count : null;
}

export function holidayCoverageWarning(value: string): string | null {
  const year = Number(value.slice(0, 4));
  return year >= 2025 && year <= 2027 ? null : "HOLIDAY_DATA_REVIEW_REQUIRED";
}
