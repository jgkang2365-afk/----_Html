import type { Availability, Coordinate, ExistingAssignment, RouteMetrics, SurveyTarget } from "./types";

export type BaseSurveyCode = "A" | "B" | "C" | "D" | "F" | "G";
export type SurveyCode = BaseSurveyCode | "AA" | "BB" | "CC" | "DD" | "FF" | "GG" | "AAA" | "BBB" | "CCC" | "DDD" | "FFF" | "GGG";

export interface MeasurementAssigneeUser {
  id: number;
  name: string;
  /** users.survey_code가 공시료 코드의 유일한 원천이다. */
  surveyCode: BaseSurveyCode | null;
  active?: boolean;
}

export interface MeasurementAssignmentTarget {
  targetId: number;
  measurementDate: string;
  address: string | null;
  coordinate: Coordinate | null;
  businessCode?: string;
  region?: string | null;
  /** 아래 역할은 배정 preference일 뿐이며 측정자 원천으로 저장·승격하지 않는다. */
  reportWriterUserId?: number | null;
  measurementParticipantUserIds?: number[];
  preliminarySurveyorUserId?: number | null;
}

export interface ExistingMeasurementAssignment extends MeasurementAssignmentTarget {
  userId: number;
}

/** 추천과 Apply 재계산이 동일한 날짜별 역할 preference target을 사용한다. */
export function buildMeasurementAssignmentTargets(input: {
  target: Pick<SurveyTarget,
    "id" | "code" | "address" | "coordinate" | "region" |
    "measurementAssignmentDates" | "measurementStaffByDate">;
  preliminarySurveyorUserId: number | null;
}): MeasurementAssignmentTarget[] {
  return (input.target.measurementAssignmentDates ?? []).map((measurementDate) => {
    const staff = input.target.measurementStaffByDate?.find((item) => item.date === measurementDate);
    return {
      targetId: input.target.id,
      measurementDate,
      address: input.target.address,
      coordinate: input.target.coordinate,
      businessCode: input.target.code,
      region: input.target.region,
      reportWriterUserId: staff?.reportWriterUserId ?? null,
      measurementParticipantUserIds: [...(staff?.measurementParticipantUserIds ?? [])],
      preliminarySurveyorUserId: input.preliminarySurveyorUserId,
    };
  });
}

/**
 * 직선거리는 후보 순위에 사용하지 않는다. 차량 경로를 실제로 조회해 얻은 evidence만 전달한다.
 * 양방향 evidence가 있으면 더 짧은 시간을 사용한다.
 */
export interface MeasurementVehicleRouteEvidence {
  fromTargetId: number;
  fromMeasurementDate: string;
  toTargetId: number;
  toMeasurementDate: string;
  source: "vehicle" | "distance" | "region" | "unknown";
  durationMinutes: number | null;
  /** route-policy가 같은 날 묶음을 허용한 실제 차량 경로만 true다. */
  allowed: boolean;
}

export interface MeasurementAssignmentResult {
  targetId: number;
  measurementDate: string;
  userId: number;
  userName: string;
  publicSampleCode: SurveyCode;
  dailyCount: number;
  approvalRequired: boolean;
  reason: "측정자 균등배정" | "동일주소 묶음" | "근거리 묶음" | "2건 배정" | "관리자 3건 예외";
}

export const MEASUREMENT_ASSIGNMENT_CAPACITY_CODE = "MEASUREMENT_ASSIGNMENT_CAPACITY_EXCEEDED";

/** 1인·1일 4건 이상은 승인으로도 허용하지 않는 planner hard block이다. */
export class MeasurementAssignmentDailyLimitError extends Error {
  readonly code = MEASUREMENT_ASSIGNMENT_CAPACITY_CODE;

  constructor(
    readonly targetId: number,
    readonly measurementDate: string,
    readonly userId: number,
  ) {
    super(MEASUREMENT_ASSIGNMENT_CAPACITY_CODE);
    this.name = "MeasurementAssignmentDailyLimitError";
  }
}

function normalizedAddress(value: string | null) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function isSurveyCode(value: string | null): value is BaseSurveyCode {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F" || value === "G";
}

function routeMinutes(
  target: MeasurementAssignmentTarget,
  existing: ExistingMeasurementAssignment,
  evidence: MeasurementVehicleRouteEvidence[],
) {
  const matched = evidence.filter((item) =>
    item.allowed === true && item.source === "vehicle" && item.durationMinutes != null && item.durationMinutes >= 0 &&
    ((item.fromTargetId === target.targetId && item.fromMeasurementDate === target.measurementDate &&
      item.toTargetId === existing.targetId && item.toMeasurementDate === existing.measurementDate) ||
    (item.toTargetId === target.targetId && item.toMeasurementDate === target.measurementDate &&
      item.fromTargetId === existing.targetId && item.fromMeasurementDate === existing.measurementDate)),
  );
  return Math.min(...matched.map((item) => item.durationMinutes as number), Number.POSITIVE_INFINITY);
}

function asRouteEntity(target: MeasurementAssignmentTarget): ExistingAssignment {
  return {
    targetId: target.targetId,
    businessCode: target.businessCode ?? String(target.targetId),
    kind: "existing",
    date: target.measurementDate,
    participants: [],
    responsibleUserId: 0,
    experiencedReviewerId: null,
    coordinate: target.coordinate,
    region: target.region ?? null,
  };
}

/** 실제 route provider 결과를 같은 측정일의 모든 후보 쌍에 대해 수집한다. */
export async function collectMeasurementVehicleRouteEvidence(input: {
  targets: MeasurementAssignmentTarget[];
  existing?: ExistingMeasurementAssignment[];
  routes: RouteMetrics;
  maximumMinutes?: number;
}): Promise<MeasurementVehicleRouteEvidence[]> {
  const maximumMinutes = input.maximumMinutes ?? 60;
  const all = [...input.targets, ...(input.existing ?? [])];
  const seen = new Set<string>();
  const pairs: Array<[MeasurementAssignmentTarget, MeasurementAssignmentTarget]> = [];
  for (const target of input.targets) {
    for (const other of all) {
      if (target.measurementDate !== other.measurementDate ||
          (target.targetId === other.targetId && target.measurementDate === other.measurementDate)) continue;
      if (normalizedAddress(target.address) && normalizedAddress(target.address) === normalizedAddress(other.address)) continue;
      const keys = [`${target.targetId}|${target.measurementDate}`, `${other.targetId}|${other.measurementDate}`].sort();
      const key = keys.join("->");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([target, other]);
    }
  }
  return Promise.all(pairs.map(async ([left, right]) => {
    const [forward, reverse] = await Promise.all([
      input.routes.between(asRouteEntity(left), asRouteEntity(right)),
      input.routes.between(asRouteEntity(right), asRouteEntity(left)),
    ]);
    const vehicleMinutes = [forward, reverse]
      .filter((metric) => metric.source === "vehicle" && metric.durationMinutes != null)
      .map((metric) => Number(metric.durationMinutes))
      .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
    const durationMinutes = vehicleMinutes.length ? Math.min(...vehicleMinutes) : null;
    return {
      fromTargetId: left.targetId,
      fromMeasurementDate: left.measurementDate,
      toTargetId: right.targetId,
      toMeasurementDate: right.measurementDate,
      source: durationMinutes == null ? "unknown" as const : "vehicle" as const,
      durationMinutes,
      allowed: durationMinutes != null && durationMinutes <= maximumMinutes,
    };
  }));
}

/**
 * 역할 원천은 독립적으로 유지하면서, 첫 순환 균등 조건 안에서 역할 일치를 preference로 사용한다.
 * 추가 배정은 현재 배정수 > 역할 일치 > 동일주소 > 실제 차량경로 > ID 순이다.
 */
export function assignMeasurementAssignees(input: {
  targets: MeasurementAssignmentTarget[];
  users: MeasurementAssigneeUser[];
  existing?: ExistingMeasurementAssignment[];
  routeEvidence?: MeasurementVehicleRouteEvidence[];
  /** 직원 제외 일정은 측정자·공시료 배정에서도 예외 없는 hard constraint다. */
  availability?: Availability;
  /** CCC는 자동 추천이 아니라 관리자가 직접 판단하는 예외 경로에서만 사용한다. */
  allowAdminThirdAssignment?: boolean;
}): MeasurementAssignmentResult[] {
  const users = input.users
    .filter((user): user is MeasurementAssigneeUser & { surveyCode: BaseSurveyCode } =>
      user.active !== false && isSurveyCode(user.surveyCode),
    )
    .sort((left, right) => left.surveyCode.localeCompare(right.surveyCode) || left.id - right.id);
  if (!users.length) return [];

  const evidence = input.routeEvidence ?? [];
  const assigned: ExistingMeasurementAssignment[] = [...(input.existing ?? [])];
  const results: MeasurementAssignmentResult[] = [];
  const targets = [...input.targets].sort((left, right) =>
    left.measurementDate.localeCompare(right.measurementDate) || left.targetId - right.targetId,
  );
  const roleMatchScore = (target: MeasurementAssignmentTarget, userId: number) =>
    Number(target.measurementParticipantUserIds?.includes(userId)) +
    Number(target.reportWriterUserId === userId) +
    Number(target.preliminarySurveyorUserId === userId);

  // 같은 날짜의 첫 순환은 6명을 한 번씩 쓰는 조건을 먼저 고정한 뒤,
  // 개별 target greedy가 아니라 순환 전체의 역할 일치 합계를 최대화한다.
  const firstCycleUserByTarget = new Map<string, number>();
  for (const measurementDate of [...new Set(targets.map((target) => target.measurementDate))]) {
    const dateTargets = targets.filter((target) => target.measurementDate === measurementDate);
    const existingOnDate = assigned.filter((item) => item.measurementDate === measurementDate);
    const unusedUsers = users.filter((user) => !existingOnDate.some((item) => item.userId === user.id));
    const batch = dateTargets.slice(0, Math.min(dateTargets.length, unusedUsers.length));
    if (!batch.length) continue;

    let bestScore = Number.NEGATIVE_INFINITY;
    let bestUserIds: number[] | null = null;
    const visit = (targetIndex: number, usedUserIds: Set<number>, selectedUserIds: number[], score: number) => {
      if (targetIndex === batch.length) {
        const isBetterTie = bestUserIds == null || selectedUserIds.some((id, index) =>
          id !== bestUserIds![index] && id < bestUserIds![index] &&
          selectedUserIds.slice(0, index).every((value, prefixIndex) => value === bestUserIds![prefixIndex]),
        );
        if (score > bestScore || (score === bestScore && isBetterTie)) {
          bestScore = score;
          bestUserIds = [...selectedUserIds];
        }
        return;
      }
      const target = batch[targetIndex];
      for (const user of unusedUsers) {
        if (usedUserIds.has(user.id) || input.availability?.isBlocked(user.id, measurementDate)) continue;
        usedUserIds.add(user.id);
        selectedUserIds.push(user.id);
        visit(targetIndex + 1, usedUserIds, selectedUserIds, score + roleMatchScore(target, user.id));
        selectedUserIds.pop();
        usedUserIds.delete(user.id);
      }
    };
    visit(0, new Set(), [], 0);
    const plannedUserIds = bestUserIds as number[] | null;
    plannedUserIds?.forEach((userId: number, index: number) => {
      firstCycleUserByTarget.set(`${measurementDate}:${batch[index].targetId}`, userId);
    });
  }

  for (const target of targets) {
    // 같은 날짜의 모든 기존 배정을 비교해 동일주소/실제 경로 후보를 판단한다.
    const sameDate = assigned.filter((item) => item.measurementDate === target.measurementDate);
    const count = (userId: number) => sameDate.filter((item) => item.userId === userId).length;
    const availableUsers = users.filter((user) => !input.availability?.isBlocked(user.id, target.measurementDate));
    // 불가 일정으로 후보가 0명이면 incomplete draft로 남긴다. 3건 hard max 소진과 구분한다.
    if (!availableUsers.length) continue;
    const plannedFirstCycleUserId = firstCycleUserByTarget.get(`${target.measurementDate}:${target.targetId}`);
    const plannedFirstCycleUser = availableUsers.find((user) =>
      user.id === plannedFirstCycleUserId && count(user.id) === 0,
    );
    const unassigned = availableUsers.filter((user) => count(user.id) === 0);
    let candidates = plannedFirstCycleUser ? [plannedFirstCycleUser]
      : unassigned.length ? unassigned : availableUsers.filter((user) => count(user.id) < 2);
    if (!candidates.length && input.allowAdminThirdAssignment) candidates = availableUsers.filter((user) => count(user.id) < 3);

    const exactAddressUsers = new Set(sameDate
      .filter((item) => normalizedAddress(item.address) && normalizedAddress(item.address) === normalizedAddress(target.address))
      .map((item) => item.userId));
    const shortestVehicleRoute = (userId: number) => Math.min(
      ...sameDate.filter((item) => item.userId === userId).map((item) => routeMinutes(target, item, evidence)),
      Number.POSITIVE_INFINITY,
    );
    candidates.sort((left, right) =>
      count(left.id) - count(right.id) ||
      roleMatchScore(target, right.id) - roleMatchScore(target, left.id) ||
      Number(!exactAddressUsers.has(left.id)) - Number(!exactAddressUsers.has(right.id)) ||
      shortestVehicleRoute(left.id) - shortestVehicleRoute(right.id) ||
      left.id - right.id,
    );
    // 해당 날짜에 가능한 측정자가 없으면 incomplete draft로 남겨 사용자 재검토를 요구한다.
    const selected = candidates[0];
    if (!selected) {
      throw new MeasurementAssignmentDailyLimitError(target.targetId, target.measurementDate, 0);
    }
    const nextCount = count(selected.id) + 1;
    if (nextCount > 2 && !input.allowAdminThirdAssignment) {
      throw new MeasurementAssignmentDailyLimitError(target.targetId, target.measurementDate, selected.id);
    }
    if (nextCount > 3) {
      throw new MeasurementAssignmentDailyLimitError(target.targetId, target.measurementDate, selected.id);
    }
    const exactAddress = exactAddressUsers.has(selected.id);
    const hasVehicleRoute = Number.isFinite(shortestVehicleRoute(selected.id));
    const approvalRequired = nextCount >= 3;
    const reason: MeasurementAssignmentResult["reason"] = approvalRequired
      ? "관리자 3건 예외"
      : exactAddress ? "동일주소 묶음"
        : hasVehicleRoute && nextCount > 1 ? "근거리 묶음"
          : nextCount > 1 ? "2건 배정" : "측정자 균등배정";
    assigned.push({ ...target, userId: selected.id });
    results.push({
      targetId: target.targetId,
      measurementDate: target.measurementDate,
      userId: selected.id,
      userName: selected.name,
      publicSampleCode: selected.surveyCode.repeat(nextCount) as SurveyCode,
      dailyCount: nextCount,
      approvalRequired,
      reason,
    });
  }
  return results;
}
