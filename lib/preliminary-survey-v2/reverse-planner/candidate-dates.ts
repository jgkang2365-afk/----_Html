import { workingDaysBefore } from "@/lib/preliminary-survey-v2/calendar";

export function candidateDates(
  measurementDate: string,
  businessType: "existing" | "first_measurement" | "external_new" = "existing",
  workingDayRows = workingDaysBefore(measurementDate, 25),
) {
  const byDistance = new Map(workingDayRows
    .map((item) => [item.workingDaysBefore, item.date]));
  const primaryDistances = businessType === "first_measurement"
    ? Array.from({ length: 18 }, (_, index) => index + 3)
    : Array.from({ length: 18 }, (_, index) => 20 - index);
  const fallbackDistances = businessType === "first_measurement"
    ? [] : Array.from({ length: 5 }, (_, index) => 25 - index);
  return {
    primary: primaryDistances.flatMap((distance) => byDistance.get(distance) ?? []),
    fallback: fallbackDistances.flatMap((distance) => byDistance.get(distance) ?? []),
  };
}

export function earliestMeasurementDate(
  values: ReadonlyArray<string | null | undefined>,
  fallback: string,
) {
  return values.filter((value): value is string => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")))
    .sort((left, right) => left.localeCompare(right))[0] ?? fallback;
}
export function isScheduleBlocked(userId: number, date: string, blocks: ReadonlyArray<{ userId: number; startDate: string; endDate: string }>) {
  return blocks.some((block) => block.userId === userId && block.startDate <= date && block.endDate >= date);
}
