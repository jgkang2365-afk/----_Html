/** 실제 측정 참여자의 읽기 전용 표시순서. 저장 배열의 순서는 변경하지 않는다. */
export const MEASUREMENT_PARTICIPANT_PRIORITY = [
  "한기문",
  "이주형",
  "강종구",
  "고유빈",
  "김민영",
] as const;

const priorityByName = new Map<string, number>(
  MEASUREMENT_PARTICIPANT_PRIORITY.map((name, index) => [name, index] as const),
);

export function orderMeasurementParticipants(
  rawParticipants: string | readonly string[] | null | undefined,
  reportWriter: string | null | undefined,
): string[] {
  const participants = Array.from(new Set(
    (Array.isArray(rawParticipants) ? rawParticipants : String(rawParticipants ?? "").split(","))
      .map((name) => name.trim())
      .filter((name) => Boolean(name) && name !== "-"),
  ));
  const writer = String(reportWriter ?? "").trim();

  if (writer && participants.includes(writer)) {
    return [writer, ...participants.filter((name) => name !== writer)];
  }

  return participants
    .map((name, originalIndex) => ({
      name,
      originalIndex,
      priority: priorityByName.get(name) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex)
    .map(({ name }) => name);
}

export function resolveLeadMeasurementParticipant(
  rawParticipants: string | readonly string[] | null | undefined,
  reportWriter: string | null | undefined,
): string | null {
  return orderMeasurementParticipants(rawParticipants, reportWriter)[0] ?? null;
}

export function formatMeasurementParticipants(
  rawParticipants: string | readonly string[] | null | undefined,
  reportWriter: string | null | undefined,
  separator = ", ",
  emptyLabel = "미지정",
): string {
  return orderMeasurementParticipants(rawParticipants, reportWriter).join(separator) || emptyLabel;
}
