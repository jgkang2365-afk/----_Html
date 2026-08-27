export interface CanonicalTargetBusinessSortValue {
  code?: string | null;
  isRegisteredText?: string | null;
  measurementMonth?: string | number | null;
}

export function targetBusinessStatusPriority(status: string | null | undefined): number {
  if (status === "미실시" || status === "미확정" || !status) return 1;
  if (status === "실시" || status === "확정") return 2;
  if (status === "거래종료" || status === "종료" || status === "거래 종료") return 3;
  return 4;
}

function measurementMonth(value: string | number | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : 99;
}

/** 측정대상 사업장 관리 화면의 기본 순서: 상태 → 예정월 → 코드. */
export function compareCanonicalTargetBusinesses(
  left: CanonicalTargetBusinessSortValue,
  right: CanonicalTargetBusinessSortValue,
): number {
  return targetBusinessStatusPriority(left.isRegisteredText) - targetBusinessStatusPriority(right.isRegisteredText)
    || measurementMonth(left.measurementMonth) - measurementMonth(right.measurementMonth)
    || String(left.code ?? "").localeCompare(String(right.code ?? ""), "ko");
}
