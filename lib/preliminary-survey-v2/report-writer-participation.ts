import { measurementDayFormsFrom, type MeasurementDaySource } from "../business/measurement-day-form";

export const REPORT_WRITER_PARTICIPATION_WARNING = "보고서 담당자 측정 참여 누락";

export function reportWriterParticipationWarning(input: {
  source: MeasurementDaySource;
  userIdByName: ReadonlyMap<string, number>;
}): string | null {
  const days = measurementDayFormsFrom(input.source);
  const daysWithReportWriter = days.filter((day) => day.measurerId != null);
  if (daysWithReportWriter.length === 0) return null;
  return daysWithReportWriter.some((day) => day.collaborators.some((name) =>
    input.userIdByName.get(name.trim()) === day.measurerId,
  ))
    ? null
    : REPORT_WRITER_PARTICIPATION_WARNING;
}

export function combineWorkbenchWarnings(...values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
