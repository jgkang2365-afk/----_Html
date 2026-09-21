import { measurementDayFormsFrom } from "@/lib/business/measurement-day-form";

export interface JournalSearchTargetSchedule {
  code?: unknown;
  year?: unknown;
  period?: unknown;
  measurement_date?: string | null;
  daily_staff?: unknown;
}

export interface JournalSearchRow {
  code?: unknown;
  measurement_year?: unknown;
  measurement_period?: unknown;
  measurement_start_date?: string | null;
}

export function journalSearchKey(code: unknown, year: unknown, period: unknown): string {
  return `${String(code ?? "").trim()}-${Number(year)}-${String(period ?? "").trim()}`;
}

export function targetMatchesJournalMeasurementDate(
  target: JournalSearchTargetSchedule | null | undefined,
  measurementDate: string | null,
): boolean {
  if (!measurementDate) return true;
  if (!target) return false;
  return measurementDayFormsFrom({
    dailyStaff: target.daily_staff,
    measurementDate: target.measurement_date,
  }).some((day) => day.date.trim() === measurementDate);
}

export function journalMatchesMeasurementDate(
  journal: JournalSearchRow | null | undefined,
  measurementDate: string | null,
  canonicalTargetKeys: ReadonlySet<string>,
): boolean {
  if (!measurementDate) return true;
  if (!journal) return false;

  if (String(journal.measurement_start_date ?? "").trim() === measurementDate) {
    return true;
  }

  return canonicalTargetKeys.has(
    journalSearchKey(journal.code, journal.measurement_year, journal.measurement_period),
  );
}
