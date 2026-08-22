/**
 * 예비조사 추천안 변경의 영향 범위를 계산한다.
 *
 * 이 모듈은 DB/API를 호출하지 않는다. 호출자는 저장된 plan과 새 draft를 합친
 * 최신 스냅샷을 전달하고, 반환된 targetIds 전체를 재검증한 뒤 lockedTargetIds를
 * 변경 대상에서 제외해야 한다.
 */

export type PreliminarySurveyImpactReason =
  | "selected"
  | "same_preliminary_date_participant"
  | "same_normalized_address"
  | "same_visit_bundle"
  | "same_measurement_date_assignee_balance"
  | "same_date_field_capacity"
  | "same_date_phone_capacity"
  | "employee_schedule_blocked"
  | "true_confirmed_locked";

export interface PreliminarySurveyImpactTarget {
  targetId: number;
  preliminaryDate?: string | null;
  participantUserIds?: readonly number[] | null;
  surveyMethod?: "field" | "phone" | null;
  address?: string | null;
  /** 주소와 별도로 사용자가 같은 방문 묶음으로 지정한 식별자 */
  visitBundleKey?: string | null;
  measurementDate?: string | null;
  /** 다일 측정은 assignment/daily_staff에 명시된 날짜 전체를 전달한다. */
  measurementDates?: readonly string[] | null;
  /** 측정자 균등 배정 판단에 사용되는 공시료 담당자 식별자 */
  measurementAssigneeUserId?: number | null;
  /** 찐확정 대상: 조회와 영향 계산에는 포함하지만 적용 대상에서는 제외한다. */
  locked?: boolean;
  /** 예비조사 역할 또는 날짜별 측정자에 후발 직원 제외 일정이 생긴 상태다. */
  scheduleBlocked?: boolean;
}

export interface PreliminarySurveyImpactScope {
  /** 재검증해야 하는 전체 대상(locked 포함), 오름차순 */
  targetIds: number[];
  /** targetIds에 편입된 근거. 하나의 대상에 여러 근거가 있을 수 있다. */
  reasonsByTarget: Record<number, PreliminarySurveyImpactReason[]>;
  /** targetIds 중 실제 변경을 시도하면 안 되는 찐확정 대상, 오름차순 */
  lockedTargetIds: number[];
}

export function normalizePreliminarySurveyImpactAddress(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function normalizedVisitBundle(value: string | null | undefined): string {
  return String(value ?? "").trim().toLocaleLowerCase("ko-KR");
}

function participants(target: PreliminarySurveyImpactTarget): Set<number> {
  return new Set((target.participantUserIds ?? [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0));
}

function hasOverlappingParticipants(
  left: PreliminarySurveyImpactTarget,
  right: PreliminarySurveyImpactTarget,
): boolean {
  const leftParticipants = participants(left);
  return [...participants(right)].some((id) => leftParticipants.has(id));
}

function relationReasons(
  source: PreliminarySurveyImpactTarget,
  candidate: PreliminarySurveyImpactTarget,
): PreliminarySurveyImpactReason[] {
  const reasons: PreliminarySurveyImpactReason[] = [];
  const samePreliminaryDate = Boolean(source.preliminaryDate) && source.preliminaryDate === candidate.preliminaryDate;

  if (samePreliminaryDate && hasOverlappingParticipants(source, candidate)) {
    reasons.push("same_preliminary_date_participant");
  }

  const sourceAddress = normalizePreliminarySurveyImpactAddress(source.address);
  const candidateAddress = normalizePreliminarySurveyImpactAddress(candidate.address);
  if (sourceAddress && sourceAddress === candidateAddress) {
    reasons.push("same_normalized_address");
  }

  const sourceBundle = normalizedVisitBundle(source.visitBundleKey);
  const candidateBundle = normalizedVisitBundle(candidate.visitBundleKey);
  if (sourceBundle && sourceBundle === candidateBundle) {
    reasons.push("same_visit_bundle");
  }

  // 공시료 담당자 균등배정은 동일 측정일 전체의 분포를 다시 계산해야 한다.
  const sourceMeasurementDates = new Set((source.measurementDates?.length
    ? source.measurementDates : source.measurementDate ? [source.measurementDate] : []).filter(Boolean));
  const candidateMeasurementDates = (candidate.measurementDates?.length
    ? candidate.measurementDates : candidate.measurementDate ? [candidate.measurementDate] : []).filter(Boolean);
  if (candidateMeasurementDates.some((date) => sourceMeasurementDates.has(date))) {
    reasons.push("same_measurement_date_assignee_balance");
  }

  // 용량은 같은 날짜·방식이라도 실제로 같은 사람이 겹칠 때만 서로 영향을 준다.
  // 주소·측정일 공시료·찐확정 관계는 사람 겹침과 무관하게 그대로 closure에 남긴다.
  const sameMethod = source.surveyMethod != null && source.surveyMethod === candidate.surveyMethod;
  const sharesCapacity = samePreliminaryDate && sameMethod && hasOverlappingParticipants(source, candidate);
  if (sharesCapacity && source.surveyMethod === "field") {
    reasons.push("same_date_field_capacity");
  }
  if (sharesCapacity && source.surveyMethod === "phone") {
    reasons.push("same_date_phone_capacity");
  }

  return reasons;
}

/**
 * 새 제안 관계까지 포함한 transitive dependency closure.
 *
 * 예를 들어 A-B가 같은 예비조사일/조사자로 연결되고 B-C가 같은 방문 묶음이면,
 * C도 A 변경의 영향 범위에 포함된다. locked 대상도 용량과 관계의 원천이므로
 * closure에는 포함·확장하지만, 호출자가 적용 단계에서 제외할 수 있게 별도 반환한다.
 */
export function calculatePreliminarySurveyImpactScope(input: {
  seedTargetIds: readonly number[];
  targets: readonly PreliminarySurveyImpactTarget[];
}): PreliminarySurveyImpactScope {
  const targetsById = new Map<number, PreliminarySurveyImpactTarget>();
  for (const target of input.targets) {
    if (Number.isInteger(target.targetId) && target.targetId > 0) {
      targetsById.set(target.targetId, target);
    }
  }

  const included = new Set<number>();
  const reasonsByTarget = new Map<number, Set<PreliminarySurveyImpactReason>>();
  const queue: number[] = [];
  const include = (targetId: number, reasons: readonly PreliminarySurveyImpactReason[]) => {
    const target = targetsById.get(targetId);
    if (!target) return;
    const targetReasons = reasonsByTarget.get(targetId) ?? new Set<PreliminarySurveyImpactReason>();
    reasons.forEach((reason) => targetReasons.add(reason));
    if (target.scheduleBlocked) targetReasons.add("employee_schedule_blocked");
    if (target.locked) targetReasons.add("true_confirmed_locked");
    reasonsByTarget.set(targetId, targetReasons);
    if (!included.has(targetId)) {
      included.add(targetId);
      queue.push(targetId);
    }
  };

  [...new Set(input.seedTargetIds)].sort((left, right) => left - right)
    .forEach((targetId) => include(targetId, ["selected"]));

  while (queue.length > 0) {
    const source = targetsById.get(queue.shift()!);
    if (!source) continue;
    for (const candidate of targetsById.values()) {
      if (candidate.targetId === source.targetId) continue;
      const reasons = relationReasons(source, candidate);
      if (reasons.length > 0) include(candidate.targetId, reasons);
    }
  }

  const targetIds = [...included].sort((left, right) => left - right);
  return {
    targetIds,
    reasonsByTarget: Object.fromEntries(targetIds.map((targetId) => [
      targetId,
      [...(reasonsByTarget.get(targetId) ?? [])].sort(),
    ])),
    lockedTargetIds: targetIds.filter((targetId) => targetsById.get(targetId)?.locked === true),
  };
}
