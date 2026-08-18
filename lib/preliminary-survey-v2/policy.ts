import { workingDayDistance } from "./calendar";

export interface ProcessChangedPolicySettings {
  enabled: boolean;
  effectiveStartYear: number | null;
  effectiveStartPeriod: string | null;
  effectiveStartMeasurementDate: string | null;
}

export interface ProcessChangedPolicyTarget {
  year: number;
  period: string;
  measurementDate: string | null;
  processChanged: boolean | null;
}

const PERIOD_RANK: Record<string, number> = { 상반기: 1, 하반기: 2 };

/**
 * 대상 사업장의 period를 반기 기준으로 정규화한다.
 * "상반기(수시)" → "상반기", "하반기(수시)" → "하반기".
 * 정책 설정 UI는 항상 "상반기"/"하반기"만 저장하므로, 여기서는 판정 시의
 * 대상 period만 정규화하면 된다.
 */
export function normalizePolicyPeriod(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  if (trimmed.startsWith("상반기")) return "상반기";
  if (trimmed.startsWith("하반기")) return "하반기";
  return trimmed;
}

export const PROCESS_CHANGED_POLICY_OFF: ProcessChangedPolicySettings = {
  enabled: false,
  effectiveStartYear: null,
  effectiveStartPeriod: null,
  effectiveStartMeasurementDate: null,
};

function dateOnly(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * 공정변경 데이터 자체의 저장 여부와 V2 추천 반영 여부를 분리한다.
 * 정책이 OFF이거나 적용 시작값/대상 측정일이 불완전하면 안전하게 미적용한다.
 * 이 함수는 "적용 대상"만 결정하며, 조사 방식·담당자·경력자 규칙을 바꾸지 않는다.
 */
export function shouldApplyProcessChangedPolicy(input: {
  policy: ProcessChangedPolicySettings;
  target: ProcessChangedPolicyTarget;
}): boolean {
  const { policy, target } = input;
  if (!policy.enabled || target.processChanged !== true) return false;

  const startPeriodRank = PERIOD_RANK[normalizePolicyPeriod(policy.effectiveStartPeriod)];
  const targetPeriodRank = PERIOD_RANK[normalizePolicyPeriod(target.period)];
  const startDate = dateOnly(policy.effectiveStartMeasurementDate);
  const targetDate = dateOnly(target.measurementDate);
  if (!Number.isInteger(policy.effectiveStartYear) || !startPeriodRank || !targetPeriodRank || !startDate || !targetDate) {
    return false;
  }

  const targetHalf = Number(target.year) * 2 + targetPeriodRank;
  const startHalf = Number(policy.effectiveStartYear) * 2 + startPeriodRank;
  return targetHalf >= startHalf && targetDate >= startDate;
}

export function targetChangeRecommendationPolicy(input: {
  responsibleChanged: boolean;
  measurementDateChanged: boolean;
  existingRecommendedDate: string | null;
  nextMeasurementDate: string | null;
}) {
  if (input.responsibleChanged) return "recalculate" as const;
  if (!input.measurementDateChanged) return "keep" as const;
  if (!input.existingRecommendedDate || !input.nextMeasurementDate) return "recalculate" as const;
  const distance = workingDayDistance(input.existingRecommendedDate, input.nextMeasurementDate);
  return distance === null || distance < 3 || distance > 30 ? "recalculate" as const : "keep" as const;
}

export interface PreliminarySurveyV2AutomationTarget {
  year: number;
  period: string;
  measurementDate: string | null;
}

/**
 * 예비조사 V2 자동추천 전체의 상위 ON/OFF 판정.
 *
 * 기존 `공정변경 예비조사 정책 사용`(preliminary_survey_policy_settings.enabled) 값을
 * V2 자동추천 계열 전체(자동 생성/재추천/추천일·예비조사자·예·측 계산/묶음 추천/확정)의
 * 마스터 스위치로 재사용한다. 별도 feature flag를 만들지 않는다.
 *
 * - enabled=false → 자동추천 전체 중지.
 * - enabled=true + target 없음(전역/API 수준) → 자동추천 허용.
 * - enabled=true + target 있음 → 적용 시작 연도/주기/측정일 기준 이후 대상만 허용.
 */
export function isPreliminarySurveyV2AutomationEnabled(
  policy: ProcessChangedPolicySettings,
  target?: PreliminarySurveyV2AutomationTarget | null,
): boolean {
  if (!policy.enabled) return false;
  if (!target) return true;

  const startPeriodRank = PERIOD_RANK[normalizePolicyPeriod(policy.effectiveStartPeriod)];
  const targetPeriodRank = PERIOD_RANK[normalizePolicyPeriod(target.period)];
  const startDate = dateOnly(policy.effectiveStartMeasurementDate);
  const targetDate = dateOnly(target.measurementDate);
  if (!Number.isInteger(policy.effectiveStartYear) || !startPeriodRank || !targetPeriodRank || !startDate || !targetDate) {
    return false;
  }
  const targetHalf = Number(target.year) * 2 + targetPeriodRank;
  const startHalf = Number(policy.effectiveStartYear) * 2 + startPeriodRank;
  return targetHalf >= startHalf && targetDate >= startDate;
}
