import { recommendationDates, recommendationDatesForBusinessType } from "./calendar";
import { evaluateSameDayRoute } from "./route-policy";
import type {
  ExistingAssignment, RouteMetrics, SameDayRouteEvidence, SurveyMethod, SurveyTarget, SurveyUser,
} from "./types";

export interface ManualPlanValidationInput {
  target: SurveyTarget;
  recommendedDate: string;
  participants: SurveyUser[];
  surveyMethod?: SurveyMethod | null;
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
  const surveyMethod = input.surveyMethod ?? (input.target.kind === "new" ? "field" : "phone");

  const allowedDates = input.target.businessType
    ? recommendationDatesForBusinessType(input.target.measurementDate, input.target.businessType)
    : recommendationDates(input.target.measurementDate);
  if (!allowedDates.some((item) => item.date === input.recommendedDate)) {
    errors.push("예비조사일은 측정일보다 3~30 워킹데이 이전이어야 합니다.");
  }
  if (!participantIds.has(input.target.responsible.id)) {
    errors.push("페이퍼 작성자는 예비조사자에 반드시 포함되어야 합니다.");
  }
  const experiencedCount = input.participants.filter((user) => user.experienced).length;
  if ((input.target.kind === "new" || surveyMethod === "field") && experiencedCount === 0) {
    errors.push("비경력자 단독 예비조사는 불가하며 경력자가 최소 1명 필요합니다.");
  }
  const requiresUserConfirmation = experiencedCount >= 2;

  const sameDate = input.existingAssignments.filter((item) => item.date === input.recommendedDate);
  const routeEvidence: SameDayRouteEvidence[] = [];
  if (input.target.kind === "new") {
    if (surveyMethod !== "field") errors.push("최초실시·타기관 신규는 방문 예비조사만 가능합니다.");
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
  } else if (surveyMethod === "phone") {
    for (const participantId of participantIds) {
      const phoneCount = sameDate.filter((item) =>
        item.kind === "existing" && item.targetId !== input.target.id && item.participants.includes(participantId),
      ).length;
      if (phoneCount >= 3) errors.push(`예비조사자 ${participantId}의 유선 배정은 하루 최대 3건입니다.`);
    }
  } else {
    const mandatoryVisits = sameDate.filter((item) =>
      item.kind === "new" && item.participants.some((participantId) => participantIds.has(participantId)),
    );
    for (const participantId of participantIds) {
      const fieldCount = sameDate.filter((item) =>
        item.surveyMethod === "field" && item.targetId !== input.target.id && item.participants.includes(participantId),
      ).length;
      if (fieldCount >= 2) errors.push(`예비조사자 ${participantId}의 방문 배정은 하루 최대 2건입니다.`);
    }
    const normalizeAddress = (value: string | null | undefined) => String(value ?? "").replace(/\s+/g, "").trim();
    const targetAddress = normalizeAddress(input.target.address);
    const bundleResults = await Promise.all(mandatoryVisits.map(async (assignment) => {
      const sameAddress = Boolean(targetAddress) && targetAddress === normalizeAddress(assignment.address);
      if (sameAddress) return { allowed: true, evidence: null };
      const route = await evaluateSameDayRoute(assignment, input.target, input.routes);
      return { allowed: route.evidence.routeDecision === "same_day_allowed", evidence: route.evidence };
    }));
    routeEvidence.push(...bundleResults.flatMap((result) => result.evidence ? [result.evidence] : []));
    if (!bundleResults.some((result) => result.allowed)) {
      errors.push("기존업체 방문은 같은 날 필수 신규 방문의 동일주소 또는 허용 동선이 필요합니다.");
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
