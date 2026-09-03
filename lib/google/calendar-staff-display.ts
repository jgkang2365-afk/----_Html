export const CALENDAR_MEASUREMENT_PARTICIPANT_PRIORITY = [
  "한기문",
  "이주형",
  "강종구",
  "고유빈",
  "김민영",
] as const;

const PARTICIPANT_PRIORITY_INDEX = new Map<string, number>(
  CALENDAR_MEASUREMENT_PARTICIPANT_PRIORITY.map((name, index) => [name, index]),
);

export function orderCalendarMeasurementParticipants(
  rawParticipants: string | null | undefined,
  reportWriter: string | null | undefined,
): string[] {
  const participants = Array.from(new Set(
    String(rawParticipants || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  ));
  const writer = String(reportWriter || "").trim();

  if (participants.length === 0) return [];

  // 보고서 담당자가 해당 일자의 실제 측정참여자이면 기존 기준대로 맨 앞에 둔다.
  if (writer && participants.includes(writer)) {
    return [writer, ...participants.filter((name) => name !== writer)];
  }

  // 보고서 담당자가 현장에 참여하지 않는 날에는 승인된 측정참여자 우선순위를 적용한다.
  // 우선순위에 없는 신규/기타 인원은 원래 입력 순서를 유지한 채 뒤에 둔다.
  return participants
    .map((name, originalIndex) => ({
      name,
      originalIndex,
      priority: PARTICIPANT_PRIORITY_INDEX.get(name) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) =>
      left.priority - right.priority || left.originalIndex - right.originalIndex,
    )
    .map(({ name }) => name);
}

export function resolveCalendarLeadParticipant(
  rawParticipants: string | null | undefined,
  reportWriter: string | null | undefined,
): string | null {
  return orderCalendarMeasurementParticipants(rawParticipants, reportWriter)[0] ?? null;
}

export function formatCalendarMeasurementParticipants(
  rawParticipants: string | null | undefined,
  reportWriter: string | null | undefined,
): string {
  const participants = orderCalendarMeasurementParticipants(rawParticipants, reportWriter);
  return participants.length > 0 ? participants.join(", ") : "미지정";
}
