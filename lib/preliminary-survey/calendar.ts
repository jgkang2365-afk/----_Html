const DAY_MS = 24 * 60 * 60 * 1000;

// 행정기관 공개 달력을 기준으로 검토한 2025~2027년 휴일 snapshot.
// 외부 호출 없이 동작하며, 범위를 벗어난 연도는 확인 경고를 반환한다.
const REVIEWED_KOREAN_HOLIDAYS = new Set([
  "2025-01-01", "2025-01-28", "2025-01-29", "2025-01-30",
  "2025-03-01", "2025-03-03", "2025-05-05", "2025-05-06",
  "2025-06-06", "2025-08-15", "2025-10-03", "2025-10-05",
  "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09",
  "2025-12-25",
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18",
  "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24",
  "2026-05-25", "2026-06-03", "2026-06-06", "2026-08-15",
  "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26",
  "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25",
  "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08",
  "2027-02-09", "2027-03-01", "2027-05-05", "2027-05-13",
  "2027-06-06", "2027-08-15", "2027-08-16", "2027-09-14",
  "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04",
  "2027-10-09", "2027-10-11", "2027-12-25", "2027-12-27",
]);

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return formatDateOnly(date) === value ? date : null;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const parsed = parseDateOnly(date);
  if (!parsed) return true;
  const day = parsed.getUTCDay();
  return day === 0 || day === 6;
}

export function isKoreanHoliday(date: string): boolean {
  return REVIEWED_KOREAN_HOLIDAYS.has(date);
}

export function isWorkingDay(date: string): boolean {
  return !isWeekend(date) && !isKoreanHoliday(date);
}

export function getHolidayCoverageWarning(date: string): string | null {
  const year = Number(date.slice(0, 4));
  return year >= 2025 && year <= 2027 ? null : "HOLIDAY_DATA_REVIEW_REQUIRED";
}

export function subtractCalendarDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  if (!parsed) throw new Error("INVALID_DATE");
  return formatDateOnly(new Date(parsed.getTime() - days * DAY_MS));
}

export function workingDaysBefore(
  measurementDate: string,
  maxWorkingDays = 30,
): Array<{ date: string; workingDaysBefore: number }> {
  if (!parseDateOnly(measurementDate)) return [];
  const result: Array<{ date: string; workingDaysBefore: number }> = [];
  let cursor = measurementDate;
  let workingDayCount = 0;
  let guard = 0;

  while (workingDayCount < maxWorkingDays && guard < 90) {
    cursor = subtractCalendarDays(cursor, 1);
    guard += 1;
    if (!isWorkingDay(cursor)) continue;
    workingDayCount += 1;
    result.push({ date: cursor, workingDaysBefore: workingDayCount });
  }

  return result;
}

export function workingDayDistance(
  earlierDate: string,
  laterDate: string,
): number | null {
  if (!parseDateOnly(earlierDate) || !parseDateOnly(laterDate) || earlierDate >= laterDate) {
    return null;
  }
  let cursor = laterDate;
  let count = 0;
  let guard = 0;
  while (cursor > earlierDate && guard < 370) {
    cursor = subtractCalendarDays(cursor, 1);
    guard += 1;
    if (isWorkingDay(cursor)) count += 1;
  }
  return cursor === earlierDate ? count : null;
}
