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
  }>;
};

/** 관리자 CCC 예외 검토에는 C/CC/CCC 세 건 전체를 같은 그룹으로 반환한다. */
export function buildThirdAssignmentReview(
  drafts: readonly ReviewDraft[],
  measurementRouteEvidence: readonly RouteEvidence[],
): ThirdAssignmentReviewGroup[] {
  const entries = drafts.flatMap((draft) => (draft.measurementAssignments ?? [])
    .map((assignment) => ({ draft, assignment })));
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.assignment.measurementDate}:${entry.assignment.userId}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()]
    .filter((group) => group.length === 3 && group.some((entry) => entry.assignment.approvalRequired === true))
    .map((group) => ({
      measurementDate: group[0].assignment.measurementDate,
      assigneeUserId: group[0].assignment.userId,
      assigneeName: group[0].assignment.userName ?? null,
      sameAddress: group.every((entry) => Boolean(entry.draft.sourceAddress) && entry.draft.sourceAddress === group[0].draft.sourceAddress),
      routeEvidenceAvailable: measurementRouteEvidence.some((evidence) => evidence.allowed === true &&
        group.some((entry) => entry.assignment.targetId === evidence.fromTargetId || entry.assignment.targetId === evidence.toTargetId)),
      targets: group.map((entry) => ({
        targetId: entry.draft.targetId,
        code: entry.draft.code ?? null,
        businessName: entry.draft.businessName ?? null,
        address: entry.draft.sourceAddress ?? null,
        surveyCode: entry.assignment.surveyCode,
      })).sort((left, right) => left.targetId - right.targetId),
    }));
}
