import { recommendationDates, recommendationDatesForBusinessType } from "./calendar";
import { evaluateSameDayRoute } from "./route-policy";
import type {
  ExistingAssignment, RouteMetrics, SameDayRouteEvidence, SurveyTarget, SurveyUser,
} from "./types";

export interface ManualPlanValidationInput {
  target: SurveyTarget;
  recommendedDate: string;
  participants: SurveyUser[];
  existingAssignments: ExistingAssignment[];
  routes: RouteMetrics;
}

export interface ManualPlanValidationResult {
  valid: boolean;
  errors: string[];
  experiencedReviewer: SurveyUser | null;
  routeEvidence: SameDayRouteEvidence[];
  /** 경력자 2명 이상 조합 등 자동 확정 전 사용자 확인이 필요한 경우 true */
  requiresUserConfirmation: boolean;
}

/** 관리자 override에도 적용되는 hard rule만 검증한다. 30분 우선순위는 의도적으로 강제하지 않는다. */
export async function validateManualPlanHardRules(
  input: ManualPlanValidationInput,
): Promise<ManualPlanValidationResult> {
  const errors: string[] = [];
  const participantIds = new Set(input.participants.map((user) => user.id));
  const reviewer = input.participants
    .filter((user) => user.id !== input.target.responsible.id && user.experienced)
    .sort((left, right) => left.id - right.id)[0] ?? null;

  const allowedDates = input.target.businessType
    ? recommendationDatesForBusinessType(input.target.measurementDate, input.target.businessType)
    : recommendationDates(input.target.measurementDate);
  if (!allowedDates.some((item) => item.date === input.recommendedDate)) {
    errors.push("예비조사일은 측정일보다 3~30 워킹데이 이전이어야 합니다.");
  }
  if (!participantIds.has(input.target.responsible.id)) {
    errors.push("페이퍼 작성자는 예비조사자에 반드시 포함되어야 합니다.");
  }
  // Phase B 기본 hard rule: 업체 유형과 관계없이 비경력자 단독은 허용하지 않는다.
  const experiencedCount = input.participants.filter((user) => user.experienced).length;
  if (experiencedCount === 0) {
    errors.push("비경력자 단독 예비조사는 불가하며 경력자가 최소 1명 필요합니다.");
  }
  const requiresUserConfirmation = experiencedCount >= 2;

  const sameDate = input.existingAssignments.filter((item) => item.date === input.recommendedDate);
  const routeEvidence: SameDayRouteEvidence[] = [];
  if (input.target.kind === "new") {
    const otherNewByTarget = new Map<number, ExistingAssignment>();
    for (const participantId of participantIds) {
      const sameParticipantNew = sameDate.filter((item) =>
        item.kind === "new" && item.targetId !== input.target.id && item.participants.includes(participantId),
      );
      if (sameParticipantNew.length >= 2) {
        errors.push(`참여자 ${participantId}의 하루 신규업체 배정은 최대 2건입니다.`);
      }
      for (const assignment of sameParticipantNew) otherNewByTarget.set(assignment.targetId, assignment);
    }
    for (const other of otherNewByTarget.values()) {
      const evaluated = await evaluateSameDayRoute(other, input.target, input.routes);
      routeEvidence.push(evaluated.evidence);
      if (evaluated.evidence.routeDecision !== "same_day_allowed") {
        errors.push(`신규 2건 차량 60분 규칙을 충족하지 못했습니다: ${evaluated.evidence.routeDecision}`);
      }
    }
  } else {
    for (const participantId of participantIds) {
      const phoneCount = sameDate.filter((item) =>
        item.kind === "existing" && item.targetId !== input.target.id && item.participants.includes(participantId),
      ).length;
      if (phoneCount >= 3) errors.push(`예비조사자 ${participantId}의 유선 배정은 하루 최대 3건입니다.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    experiencedReviewer: reviewer,
    routeEvidence,
    requiresUserConfirmation,
  };
}
