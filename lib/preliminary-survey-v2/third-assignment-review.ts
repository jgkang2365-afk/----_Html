type ReviewDraft = {
  targetId: number;
  code?: string | null;
  businessName?: string | null;
  sourceAddress?: string | null;
  measurementAssignments?: Array<{
    targetId: number;
    measurementDate: string;
    userId: number;
    userName?: string | null;
    surveyCode: string;
    approvalRequired?: boolean;
  }>;
};

type RouteEvidence = {
  allowed?: boolean;
  fromTargetId?: number;
  toTargetId?: number;
};

export type PersistedThirdAssignmentReviewItem = {
  targetId: number;
  code?: string | null;
  businessName?: string | null;
  sourceAddress?: string | null;
  measurementDate: string;
  userId: number;
  userName?: string | null;
  surveyCode: string;
  baseSurveyCode?: string | null;
  createdAt?: string | null;
};

export type ThirdAssignmentReviewGroup = {
  measurementDate: string;
  assigneeUserId: number;
  assigneeName: string | null;
  sameAddress: boolean;
  routeEvidenceAvailable: boolean;
  targets: Array<{
    targetId: number;
    code: string | null;
    businessName: string | null;
    address: string | null;
    surveyCode: string;
    previousSurveyCode: string | null;
  }>;
};

/** 관리자 CCC 예외 검토에는 C/CC/CCC 세 건 전체를 같은 그룹으로 반환한다. */
export function buildThirdAssignmentReview(
  drafts: readonly ReviewDraft[],
  persistedAssignments: readonly PersistedThirdAssignmentReviewItem[],
  measurementRouteEvidence: readonly RouteEvidence[],
): ThirdAssignmentReviewGroup[] {
  const persistedByTargetDate = new Map(persistedAssignments.map((assignment) =>
    [`${assignment.targetId}:${assignment.measurementDate}`, assignment]));
  const proposedEntries = drafts.flatMap((draft) => (draft.measurementAssignments ?? [])
    .map((assignment) => ({
      draft,
      assignment,
      proposed: true,
      createdAt: null,
      previousSurveyCode: persistedByTargetDate.get(`${assignment.targetId}:${assignment.measurementDate}`)?.surveyCode ?? null,
      baseSurveyCode: assignment.surveyCode.slice(0, 1),
    })));
  const proposedTargetDates = new Set(proposedEntries.map((entry) =>
    `${entry.assignment.targetId}:${entry.assignment.measurementDate}`));
  const persistedEntries = persistedAssignments
    .filter((assignment) => !proposedTargetDates.has(`${assignment.targetId}:${assignment.measurementDate}`))
    .map((assignment) => ({
      draft: {
        targetId: assignment.targetId,
        code: assignment.code ?? null,
        businessName: assignment.businessName ?? null,
        sourceAddress: assignment.sourceAddress ?? null,
      },
      assignment: {
        targetId: assignment.targetId,
        measurementDate: assignment.measurementDate,
        userId: assignment.userId,
        userName: assignment.userName ?? null,
        surveyCode: assignment.surveyCode,
        approvalRequired: false,
      },
      proposed: false,
      createdAt: assignment.createdAt ?? null,
      previousSurveyCode: assignment.surveyCode,
      baseSurveyCode: assignment.baseSurveyCode ?? assignment.surveyCode.slice(0, 1),
    }));
  const entries = [...persistedEntries, ...proposedEntries];
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.assignment.measurementDate}:${entry.assignment.userId}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()]
    .filter((group) => group.length === 3 && group.some((entry) => entry.assignment.approvalRequired === true))
    .map((group) => {
      // DB wrapper parity: persisted rows first, then created_at and target ID order.
      const ranked = [...group].sort((left, right) => Number(left.proposed) - Number(right.proposed) ||
        String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) ||
        left.assignment.targetId - right.assignment.targetId);
      const baseSurveyCode = String(ranked[0].baseSurveyCode ?? ranked[0].assignment.surveyCode).trim().slice(0, 1).toUpperCase();
      return {
      measurementDate: ranked[0].assignment.measurementDate,
      assigneeUserId: ranked[0].assignment.userId,
      assigneeName: ranked[0].assignment.userName ?? null,
      sameAddress: ranked.every((entry) => Boolean(entry.draft.sourceAddress) && entry.draft.sourceAddress === ranked[0].draft.sourceAddress),
      routeEvidenceAvailable: measurementRouteEvidence.some((evidence) => evidence.allowed === true &&
        ranked.some((entry) => entry.assignment.targetId === evidence.fromTargetId || entry.assignment.targetId === evidence.toTargetId)),
      targets: ranked.map((entry, index) => ({
        targetId: entry.draft.targetId,
        code: entry.draft.code ?? null,
        businessName: entry.draft.businessName ?? null,
        address: entry.draft.sourceAddress ?? null,
        surveyCode: baseSurveyCode.repeat(index + 1),
        previousSurveyCode: entry.previousSurveyCode,
      })),
    };
    });
}
