import { recommendationDates, recommendationDatesForBusinessType } from "./calendar";
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

/** 관리자 override에도 적용되는 서류 정합성 hard rule만 검증한다. */
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
  const requiresUserConfirmation = experiencedCount >= 2;

  if (input.target.kind === "new") {
    if (surveyMethod !== "field") errors.push("최초실시·타기관 신규는 방문 예비조사만 가능합니다.");
  } else if (surveyMethod !== "phone") {
    errors.push("기존업체는 유선 예비조사 방식이어야 합니다.");
  }

  // 같은 날 일정·예비조사 건수·이동 동선은 실제 수행 가능성 정보이며
  // 서류 기준일과 조사자 구성을 저장하는 hard rule로 사용하지 않는다.
  void input.existingAssignments;
  void input.routes;

  return {
    valid: errors.length === 0,
    errors,
    experiencedReviewer: reviewer,
    routeEvidence: [],
    requiresUserConfirmation,
  };
}
