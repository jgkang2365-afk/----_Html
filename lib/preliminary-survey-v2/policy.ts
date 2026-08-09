import { workingDayDistance } from "./calendar";

export function targetChangeRecommendationPolicy(input: {
  responsibleChanged: boolean;
  measurementDateChanged: boolean;
  existingRecommendedDate: string | null;
  nextMeasurementDate: string | null;
}) {
  if (input.responsibleChanged) return "recalculate" as const;
  if (!input.measurementDateChanged) return "keep" as const;
  if (!input.existingRecommendedDate || !input.nextMeasurementDate) return "recalculate" as const;
  const distance = workingDayDistance(input.existingRecommendedDate, input.nextMeasurementDate);
  return distance === null || distance < 3 || distance > 30 ? "recalculate" as const : "keep" as const;
}
