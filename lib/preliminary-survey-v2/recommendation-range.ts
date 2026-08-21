const KST_TIME_ZONE = "Asia/Seoul";
const DAY_MS = 86_400_000;

export type DateRange = {
  startDate: string;
  endDate: string;
};

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

function currentDateInKst(now: Date): string {
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

/** 기준일이 속한 주의 다음 주 월요일부터 금요일까지의 달력 범위. */
export function getNextWeekRangeKst(baseDate?: string, now: Date = new Date()): DateRange {
  const referenceDate = parseDateOnly(baseDate ?? currentDateInKst(now));
  const weekday = referenceDate.getUTCDay();
  const daysUntilNextMonday = weekday === 0 ? 1 : 8 - weekday;
  const start = new Date(referenceDate.getTime() + daysUntilNextMonday * DAY_MS);
  const end = new Date(start.getTime() + 4 * DAY_MS);

  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
  };
}
