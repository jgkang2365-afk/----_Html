export function formatCalendarMeasurementParticipants(
  rawParticipants: string | null | undefined,
  reportWriter: string | null | undefined,
): string {
  const participants = Array.from(new Set(
    String(rawParticipants || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  ));
  const writer = String(reportWriter || "").trim();

  if (participants.length === 0) return "미지정";
  if (!writer || !participants.includes(writer)) return participants.join(", ");

  return [writer, ...participants.filter((name) => name !== writer)].join(", ");
}
