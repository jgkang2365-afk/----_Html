import { recommendationDatesForBusinessType, workingDayDistance } from "./calendar";

export type PreliminarySurveyPolicyBusinessType = "first_measurement" | "external_new" | "existing";
export type PreliminarySurveyDatePolicyIssue =
  | "MISSING_PRELIMINARY_DATE"
  | "INVALID_PRELIMINARY_DATE"
  | "OUTSIDE_POLICY_RANGE"
  | "FALLBACK_PRIORITY_REVIEW";

export type PreliminarySurveyMethodPolicyIssue =
  | "POLICY_MISMATCH_FIRST_MEASUREMENT_METHOD"
  | "POLICY_MISMATCH_EXTERNAL_NEW_METHOD";

export interface PreliminarySurveyDatePolicyCheck {
  compliant: boolean;
  issues: PreliminarySurveyDatePolicyIssue[];
  workingDaysBefore: number | null;
  candidateRank: number | null;
  /** fallback 날짜는 실제 당시의 불가 일정·용량을 재현하지 못하므로 "위반 가능성"으로만 표시한다. */
  priorityReviewRequired: boolean;
}

/**
 * 확정 plan을 자동 변경하지 않고 운영지침의 날짜 후보 순서에 비춰 진단한다.
 * availability/history가 없는 과거 데이터에서는 fallback 사용의 정당성을 증명할 수 없으므로
 * primary 후보보다 뒤인 사실만 repair 검토 플래그로 남긴다.
 */
export function checkPreliminarySurveyDatePolicy(input: {
  measurementDate: string | null | undefined;
  preliminaryDate: string | null | undefined;
  businessType: PreliminarySurveyPolicyBusinessType | null | undefined;
}): PreliminarySurveyDatePolicyCheck {
  const measurementDate = String(input.measurementDate ?? "").trim();
  const preliminaryDate = String(input.preliminaryDate ?? "").trim();
  if (!preliminaryDate) {
    return { compliant: false, issues: ["MISSING_PRELIMINARY_DATE"], workingDaysBefore: null, candidateRank: null, priorityReviewRequired: false };
  }
  if (!input.businessType || !/^\d{4}-\d{2}-\d{2}$/.test(measurementDate) || !/^\d{4}-\d{2}-\d{2}$/.test(preliminaryDate)) {
    return { compliant: false, issues: ["INVALID_PRELIMINARY_DATE"], workingDaysBefore: null, candidateRank: null, priorityReviewRequired: false };
  }
  const candidates = recommendationDatesForBusinessType(measurementDate, input.businessType);
  const candidateRank = candidates.findIndex((candidate) => candidate.date === preliminaryDate);
  const workingDaysBefore = workingDayDistance(preliminaryDate, measurementDate);
  if (candidateRank < 0) {
    return { compliant: false, issues: ["OUTSIDE_POLICY_RANGE"], workingDaysBefore, candidateRank: null, priorityReviewRequired: false };
  }
  const fallbackStart = input.businessType === "first_measurement"
    ? Number.POSITIVE_INFINITY
    : candidates.findIndex((candidate) => candidate.workingDaysBefore > 20);
  const priorityReviewRequired = fallbackStart >= 0 && candidateRank >= fallbackStart;
  return {
    compliant: !priorityReviewRequired,
    issues: priorityReviewRequired ? ["FALLBACK_PRIORITY_REVIEW"] : [],
    workingDaysBefore,
    candidateRank,
    priorityReviewRequired,
  };
}

export function preliminarySurveyDatePolicyMessage(check: PreliminarySurveyDatePolicyCheck) {
  if (check.issues.includes("MISSING_PRELIMINARY_DATE")) return "예비조사일 누락";
  if (check.issues.includes("INVALID_PRELIMINARY_DATE")) return "예비조사일 또는 측정예정일 형식 오류";
  if (check.issues.includes("OUTSIDE_POLICY_RANGE")) return "운영지침 날짜 범위 불일치";
  if (check.issues.includes("FALLBACK_PRIORITY_REVIEW")) return "fallback 날짜 사용 · 우선 탐색 검토 필요";
  return null;
}

export function checkPreliminarySurveyMethodPolicy(input: {
  businessType: PreliminarySurveyPolicyBusinessType | null | undefined;
  surveyMethod: string | null | undefined;
}): PreliminarySurveyMethodPolicyIssue | null {
  if (input.businessType === "first_measurement" && input.surveyMethod !== "field") {
    return "POLICY_MISMATCH_FIRST_MEASUREMENT_METHOD";
  }
  if (input.businessType === "external_new" && input.surveyMethod !== "field") {
    return "POLICY_MISMATCH_EXTERNAL_NEW_METHOD";
  }
  return null;
}

export function preliminarySurveyMethodPolicyMessage(issue: PreliminarySurveyMethodPolicyIssue | null) {
  if (issue === "POLICY_MISMATCH_FIRST_MEASUREMENT_METHOD") return "최초실시 방문 필수 위반";
  if (issue === "POLICY_MISMATCH_EXTERNAL_NEW_METHOD") return "타기관 신규 방문 필수 위반";
  return null;
}
