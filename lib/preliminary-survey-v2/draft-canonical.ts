export interface RecommendationScopeSnapshot {
  measurementDateFrom: string | null;
  measurementDateTo: string | null;
  preliminaryDateFrom: string | null;
  preliminaryDateTo: string | null;
}

export interface CanonicalSurveyDraft {
  targetId: number;
  preliminaryDate: string | null;
  participantUserIds: number[];
  surveyors: string[];
  surveyMethod: "field" | "phone";
  sourceMeasurementDate: string;
  sourceMeasurerId: number | null;
  sourceResponsibleUserId: number;
  sourceRuleType: "new" | "existing";
  sourceAddress: string | null;
  sourceMeasurementParticipants: string;
  sourcePlanFingerprint: string;
  reason: string | null;
}

export interface CanonicalMeasurementAssignmentDraft {
  /** 저장된 배정을 권한자가 날짜별 수정할 때만 존재한다. 추천 draft에는 포함하지 않는다. */
  assignmentId?: string;
  targetId: number;
  measurementDate: string;
  userId: number;
  userName: string;
  surveyCode: "A" | "B" | "C" | "D" | "F" | "G" | "AA" | "BB" | "CC" | "DD" | "FF" | "GG" | "AAA" | "BBB" | "CCC" | "DDD" | "FFF" | "GGG";
  approvalRequired: boolean;
  reason: string;
}

export interface CanonicalWorkbenchDraft {
  scope: RecommendationScopeSnapshot;
  surveys: CanonicalSurveyDraft[];
  measurementAssignments: CanonicalMeasurementAssignmentDraft[];
}

/** 배열·선택 순서와 무관한 fingerprint 입력을 만든다. */
export function canonicalizeWorkbenchDraft(input: CanonicalWorkbenchDraft): CanonicalWorkbenchDraft {
  return {
    scope: {
      measurementDateFrom: input.scope.measurementDateFrom ?? null,
      measurementDateTo: input.scope.measurementDateTo ?? null,
      preliminaryDateFrom: input.scope.preliminaryDateFrom ?? null,
      preliminaryDateTo: input.scope.preliminaryDateTo ?? null,
    },
    surveys: input.surveys.map((survey) => ({
      ...survey,
      participantUserIds: [...survey.participantUserIds],
      surveyors: [...survey.surveyors],
      reason: survey.reason ?? null,
    })).sort((left, right) => left.targetId - right.targetId),
    measurementAssignments: input.measurementAssignments.map((assignment) => ({ ...assignment }))
      .sort((left, right) => left.targetId - right.targetId ||
        left.measurementDate.localeCompare(right.measurementDate) || left.userId - right.userId),
  };
}

export function sameCanonicalWorkbenchDraft(left: CanonicalWorkbenchDraft, right: CanonicalWorkbenchDraft) {
  return JSON.stringify(canonicalizeWorkbenchDraft(left)) === JSON.stringify(canonicalizeWorkbenchDraft(right));
}
