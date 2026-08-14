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

  const startPeriodRank = PERIOD_RANK[policy.effectiveStartPeriod ?? ""];
  const targetPeriodRank = PERIOD_RANK[String(target.period).trim()];
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
