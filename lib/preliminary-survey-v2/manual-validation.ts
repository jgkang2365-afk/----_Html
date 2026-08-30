import { recommendationDates, recommendationDatesForBusinessType } from "./calendar";
import { evaluateSameDayRoute } from "./route-policy";
import type {
  ExistingAssignment, RouteMetrics, SameDayRouteEvidence, SurveyMethod, SurveyTarget, SurveyUser,
} from "./types";
import { fitsExistingPhoneResponsibleLimit } from "./responsible-capacity";

export interface ManualPlanValidationInput {
  target: SurveyTarget;
  recommendedDate: string;
  participants: SurveyUser[];
  surveyMethod?: SurveyMethod | null;
  existingAssignments: ExistingAssignment[];
  routes: RouteMetrics;
  /** 자동추천·작업대와 같은 경력자 후보군. 없으면 기존 수동 입력 호환만 유지한다. */
  experiencedUsers?: SurveyUser[];
  /** 후보일의 직원 제외/실측 충돌 hard rule. */
  availability?: { isBlocked(userId: number, date: string): boolean };
}

export interface ManualPlanValidationResult {
  valid: boolean;
  errors: string[];
  experiencedReviewer: SurveyUser | null;
  warnings: string[];
  routeEvidence: SameDayRouteEvidence[];
  /** 경력자 2명 이상 조합 등 자동 확정 전 사용자 확인이 필요한 경우 true */
  requiresUserConfirmation: boolean;
}

function assignmentSurveyMethod(assignment: ExistingAssignment) {
  return assignment.surveyMethod ?? (assignment.kind === "new" ? "field" : "phone");
}

/** 관리자 override에도 적용되는 hard rule만 검증한다. 30분 우선순위는 의도적으로 강제하지 않는다. */
export async function validateManualPlanHardRules(
  input: ManualPlanValidationInput,
): Promise<ManualPlanValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const participantIds = new Set(input.participants.map((user) => user.id));
  const reviewer = input.participants
    .filter((user) => user.id !== input.target.responsible.id && user.experienced)
    .sort((left, right) => left.id - right.id)[0] ?? null;
  const surveyMethod = input.surveyMethod ?? (input.target.kind === "new" ? "field" : "phone");

  const allowedDates = input.target.businessType
    ? recommendationDatesForBusinessType(input.target.measurementDate, input.target.businessType)
    : recommendationDates(input.target.measurementDate);
  if (!allowedDates.some((item) => item.date === input.recommendedDate)) {
    errors.push("예비조사일은 측정일보다 앞선 업체 유형별 영업일 범위 안이어야 합니다.");
  }
  if (!participantIds.has(input.target.responsible.id)) {
    errors.push("페이퍼 작성자는 예비조사자에 반드시 포함되어야 합니다.");
  }
  if (input.participants.some((user) => user.active === false)) {
    errors.push("비활성 사용자는 예비조사자로 배정할 수 없습니다.");
  }
  const experiencedCount = input.participants.filter((user) => user.experienced).length;
  if ((input.target.kind === "new" || surveyMethod === "field") && experiencedCount === 0) {
    errors.push("비경력자 단독 예비조사는 불가하며 경력자가 최소 1명 필요합니다.");
  }
  // 기존업체의 비경력 책임자도 가능한 경력 검토자를 반드시 포함한다. 다만 후보군 전체가
  // 해당 날짜의 hard rule에 막힌 경우에는 원천 보존/수동 경로가 null reviewer를 명시적으로 남긴다.
  if (input.target.kind === "existing" && !input.target.responsible.experienced && input.experiencedUsers) {
    const candidates = input.experiencedUsers.filter((user) =>
      user.active !== false && user.id !== input.target.responsible.id,
    );
    const available = candidates.filter((user) => !input.availability?.isBlocked(user.id, input.recommendedDate));
    if (available.length > 0 && !reviewer) {
      errors.push("기존업체 비경력 책임자에는 가능한 경력 검토자가 반드시 필요합니다.");
    } else if (available.length === 0) {
      warnings.push(candidates.length > 0
        ? "EXPERIENCED_REVIEWER_ALL_HARD_BLOCKED"
        : "EXPERIENCED_REVIEWER_UNAVAILABLE");
    }
  }
  const requiresUserConfirmation = experiencedCount >= 2;

  const sameDate = input.existingAssignments.filter((item) => item.date === input.recommendedDate);
  const routeEvidence: SameDayRouteEvidence[] = [];
  if (input.target.kind === "new") {
    if (surveyMethod !== "field") errors.push("최초실시·타기관 신규는 방문 예비조사만 가능합니다.");
    const otherFieldByTarget = new Map<number, ExistingAssignment>();
    for (const participantId of participantIds) {
      const sameParticipantField = sameDate.filter((item) =>
        assignmentSurveyMethod(item) === "field" && item.targetId !== input.target.id && item.participants.includes(participantId),
      );
      if (sameParticipantField.length >= 2) {
        errors.push(`참여자 ${participantId}의 하루 방문 배정은 최대 2건입니다.`);
      }
      for (const assignment of sameParticipantField) otherFieldByTarget.set(assignment.targetId, assignment);
    }
    for (const other of otherFieldByTarget.values()) {
      const evaluated = await evaluateSameDayRoute(other, input.target, input.routes);
      routeEvidence.push(evaluated.evidence);
      if (evaluated.evidence.routeDecision !== "same_day_allowed") {
        errors.push(`신규 2건 차량 60분 규칙을 충족하지 못했습니다: ${evaluated.evidence.routeDecision}`);
      }
    }
  } else if (surveyMethod === "phone") {
    if (!fitsExistingPhoneResponsibleLimit(
      input.existingAssignments.filter((item) => item.targetId !== input.target.id),
      input.target.responsible.id,
      input.recommendedDate,
    )) {
      errors.push("기존업체 유선 예비조사 책임자는 같은 날 최대 3건까지 배정할 수 있습니다.");
    }
  } else {
    const mandatoryVisits = sameDate.filter((item) =>
      item.kind === "new" && item.participants.some((participantId) => participantIds.has(participantId)),
    );
    for (const participantId of participantIds) {
      const fieldCount = sameDate.filter((item) =>
        assignmentSurveyMethod(item) === "field" && item.targetId !== input.target.id && item.participants.includes(participantId),
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
    warnings,
    routeEvidence,
    requiresUserConfirmation,
  };
}
