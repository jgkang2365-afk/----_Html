import { measurementDayFormsFrom } from "@/lib/business/measurement-day-form";

export const POST_SEPTEMBER_MEASUREMENT_START = "2026-09-01";

export interface MeasurementDateSource {
  measurement_date: string | null;
  daily_staff: unknown;
  measurer_id?: number | null;
  collaborators?: unknown;
}

/** The dated daily staff rows replace the single-day field for multi-day work. */
export function currentMeasurementDates(source: MeasurementDateSource): string[] {
  return [...new Set(measurementDayFormsFrom({
    dailyStaff: source.daily_staff,
    measurementDate: source.measurement_date,
    measurerId: source.measurer_id ?? null,
    collaborators: source.collaborators,
  }).map((day) => day.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

export function postSeptemberMeasurementDates(source: MeasurementDateSource): string[] {
  return currentMeasurementDates(source).filter((date) => date >= POST_SEPTEMBER_MEASUREMENT_START);
}

export function currentAssignmentsForDisplay<T extends { measurement_date: string }>(
  source: MeasurementDateSource,
  assignments: T[],
): T[] {
  const dates = new Set(currentMeasurementDates(source));
  return assignments.filter((assignment) => dates.has(assignment.measurement_date));
}

export function journalConfirmationKey(code: unknown, year: unknown, period: unknown): string {
  return `${code}|${Number(year)}|${String(period ?? "").trim().replace("(수시)", "")}`;
}

/** Page after restricting by measurement year: PostgREST's default 1000-row cap is not authority. */
export async function loadJournalConfirmationKeys(
  supabase: any,
  codes: string[],
  years: number[],
): Promise<Set<string>> {
  if (!codes.length || !years.length) return new Set();
  const keys = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("measurement_journal")
      .select("id, code, measurement_year, measurement_period")
      .in("code", codes).in("measurement_year", years)
      .order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      keys.add(journalConfirmationKey(row.code, row.measurement_year, row.measurement_period));
    }
    if ((data ?? []).length < pageSize) return keys;
  }
}
