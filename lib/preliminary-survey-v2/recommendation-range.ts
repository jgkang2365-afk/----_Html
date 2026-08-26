const KST_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 86_400_000;

export type DateRange = {
  startDate: string;
  endDate: string;
};

export type MeasurementRangeUnit = "day" | "week" | "month";

export function dateRangeFromStartDate(startDate: string): DateRange {
  return { startDate, endDate: startDate };
}

export function validateMeasurementDateRange(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return "측정예정일의 시작일과 종료일을 입력해 주세요.";
  if (endDate < startDate) return "측정예정 종료일은 시작일보다 빠를 수 없습니다.";
  return null;
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("INVALID_DATE");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("INVALID_DATE");
  }

  return date;
}

function formatDateOnly(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addCalendarDays(value: string, amount: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function moveMonthWithClamp(value: string, amount: number): string {
  const date = parseDateOnly(value);
  const targetMonthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  const targetDay = Math.min(
    date.getUTCDate(),
    daysInMonth(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth()),
  );
  targetMonthStart.setUTCDate(targetDay);
  return formatDateOnly(targetMonthStart);
}

export function currentDateInKst(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

/** 측정 기준일과 조회 단위에서 실제 API/화면 필터 범위를 계산한다. */
export function measurementRangeFromReference(
  referenceDate: string,
  unit: MeasurementRangeUnit,
): DateRange {
  const reference = parseDateOnly(referenceDate);
  if (unit === "day") return { startDate: referenceDate, endDate: referenceDate };

  if (unit === "month") {
    const year = reference.getUTCFullYear();
    const month = reference.getUTCMonth();
    return {
      startDate: formatDateOnly(new Date(Date.UTC(year, month, 1))),
      endDate: formatDateOnly(new Date(Date.UTC(year, month, daysInMonth(year, month)))),
    };
  }

  const weekday = reference.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(reference.getTime() - daysSinceMonday * DAY_MS);
  return {
    startDate: formatDateOnly(monday),
    endDate: formatDateOnly(new Date(monday.getTime() + 4 * DAY_MS)),
  };
}

/** 현재 단위에 맞춰 기준일만 이전/다음으로 이동한다. */
export function adjacentMeasurementReferenceDate(
  referenceDate: string,
  unit: MeasurementRangeUnit,
  direction: -1 | 1,
): string {
  if (unit === "month") return moveMonthWithClamp(referenceDate, direction);
  return addCalendarDays(referenceDate, direction * (unit === "week" ? 7 : 1));
}

/** 기준일이 속한 주의 다음 주 월요일부터 금요일까지의 달력 범위. */
export function getNextWeekRangeKst(baseDate?: string, now: Date = new Date()): DateRange {
  return getAdjacentWeekRangeKst(baseDate, 1, now);
}

/** 기준일이 속한 주에서 이전/다음 주 월요일~금요일 범위를 계산한다. */
export function getAdjacentWeekRangeKst(
  baseDate: string | undefined,
  direction: -1 | 1,
  now: Date = new Date(),
): DateRange {
  const referenceDate = baseDate ?? currentDateInKst(now);
  return measurementRangeFromReference(
    adjacentMeasurementReferenceDate(referenceDate, "week", direction),
    "week",
  );
}
