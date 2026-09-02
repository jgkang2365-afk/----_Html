export interface PreliminarySurveyDisplayParticipant {
  name: string;
  experienced?: boolean | null;
}

/**
 * 업무 화면의 예비조사자 표시만 경력자 → 비경력자 → 경력정보 미확인 순으로 정렬한다.
 * 같은 분류 안에서는 source order를 유지하며 저장 역할이나 payload 순서는 변경하지 않는다.
 */
export function sortPreliminarySurveyParticipantsForDisplay<T>(
  participants: readonly T[],
  toDisplayParticipant: (participant: T) => PreliminarySurveyDisplayParticipant,
) {
  const rank = (experienced: boolean | null | undefined) =>
    experienced === true ? 0 : experienced === false ? 1 : 2;

  return participants
    .map((participant, sourceIndex) => ({ participant, sourceIndex, display: toDisplayParticipant(participant) }))
    .sort((left, right) =>
      rank(left.display.experienced) - rank(right.display.experienced)
      || left.sourceIndex - right.sourceIndex
    )
    .map(({ participant }) => participant);
}

export function formatPreliminarySurveyParticipantsForDisplay(
  participants: readonly PreliminarySurveyDisplayParticipant[],
  separator = " · ",
) {
  return sortPreliminarySurveyParticipantsForDisplay(participants, (participant) => participant)
    .map((participant) => participant.name.trim())
    .filter(Boolean)
    .join(separator) || "-";
}
