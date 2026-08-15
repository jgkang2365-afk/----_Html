export type V2PlanStatus = "recommended" | "manual_required";
export type V2SurveyMethod = "field" | "phone";

export function v2StatusLabel(status: V2PlanStatus): string {
  return status === "recommended" ? "추천 완료" : "수동 조정 필요";
}

export function v2SurveyMethodLabel(method: V2SurveyMethod): string {
  return method === "field" ? "현장 방문" : "전화";
}

export function v2BusinessKindLabel(
  sourceRuleType: string,
  recommendationReason: Record<string, unknown> | null,
): string {
  if (sourceRuleType === "existing") return "기존";
  const evidence = recommendationReason?.evidence as
    | Record<string, unknown>
    | undefined;
  const classificationSource = evidence?.classificationSource as
    | Record<string, unknown>
    | undefined;
  const rawValue = String(classificationSource?.rawValue || "");
  if (rawValue === "external_new" || rawValue.includes("타기관 신규")) return "타기관 신규";
  return "최초실시";
}

const WARNING_LABELS: Record<string, string> = {
  HOLIDAY_DATA_REVIEW_REQUIRED: "공휴일 데이터 확인이 필요합니다.",
  NO_AVAILABLE_DATE_THROUGH_MINUS_3:
    "측정일 3근무일 전까지 가능한 일정이 없어 수동 조정이 필요합니다.",
};

export function v2WarningLabel(warning: string): string {
  return WARNING_LABELS[warning] || "추천 조건을 추가로 확인해야 합니다.";
}
