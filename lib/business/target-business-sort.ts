export interface CanonicalTargetBusinessSortValue {
  code?: string | null;
  isRegisteredText?: string | null;
  measurementMonth?: string | number | null;
}

export function targetBusinessStatusPriority(status: string | null | undefined): number {
  const normalized = String(status ?? "").trim().replace(/\s+/g, " ");
  if (normalized === "미실시" || normalized === "미확정" || normalized === "대기" || !normalized) return 1;
  if (normalized === "실시" || normalized === "확정" || normalized === "완료") return 2;
  if (normalized === "거래종료" || normalized === "종료" || normalized === "거래 종료") return 3;
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
