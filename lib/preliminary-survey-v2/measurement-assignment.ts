import type { Coordinate, ExistingAssignment, RouteMetrics } from "./types";

export type SurveyCode = "A" | "B" | "C" | "D" | "F" | "G";

export interface MeasurementAssigneeUser {
  id: number;
  name: string;
  /** users.survey_code가 공시료 코드의 유일한 원천이다. */
  surveyCode: SurveyCode | null;
  active?: boolean;
}

export interface MeasurementAssignmentTarget {
  targetId: number;
  measurementDate: string;
  address: string | null;
  coordinate: Coordinate | null;
  businessCode?: string;
  region?: string | null;
}

export interface ExistingMeasurementAssignment extends MeasurementAssignmentTarget {
  userId: number;
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
  reason: "측정자 균등배정" | "동일주소 묶음" | "근거리 묶음" | "2건 배정" | "3건 승인 필요";
}

function normalizedAddress(value: string | null) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function isSurveyCode(value: string | null): value is SurveyCode {
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
 * 예비조사자·실측정자·보고서 담당자와 무관하게 측정자(공시료 담당자)를 배정한다.
 * 첫 순환은 하루별 균등 배정이고, 추가 배정은 동일주소 > 실제 차량경로 > 현재 배정수 > ID다.
 */
export function assignMeasurementAssignees(input: {
  targets: MeasurementAssignmentTarget[];
  users: MeasurementAssigneeUser[];
  existing?: ExistingMeasurementAssignment[];
  routeEvidence?: MeasurementVehicleRouteEvidence[];
}): MeasurementAssignmentResult[] {
  const users = input.users
    .filter((user): user is MeasurementAssigneeUser & { surveyCode: SurveyCode } =>
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

  for (const target of targets) {
    // 같은 날짜의 모든 기존 배정을 비교해 동일주소/실제 경로 후보를 판단한다.
    const sameDate = assigned.filter((item) => item.measurementDate === target.measurementDate);
    const count = (userId: number) => sameDate.filter((item) => item.userId === userId).length;
    const unassigned = users.filter((user) => count(user.id) === 0);
    let candidates = unassigned.length ? unassigned : users.filter((user) => count(user.id) < 2);
    if (!candidates.length) candidates = users;

    const exactAddressUsers = new Set(sameDate
      .filter((item) => normalizedAddress(item.address) && normalizedAddress(item.address) === normalizedAddress(target.address))
      .map((item) => item.userId));
    const shortestVehicleRoute = (userId: number) => Math.min(
      ...sameDate.filter((item) => item.userId === userId).map((item) => routeMinutes(target, item, evidence)),
      Number.POSITIVE_INFINITY,
    );
    candidates.sort((left, right) =>
      Number(!exactAddressUsers.has(left.id)) - Number(!exactAddressUsers.has(right.id)) ||
      shortestVehicleRoute(left.id) - shortestVehicleRoute(right.id) ||
      count(left.id) - count(right.id) || left.id - right.id,
    );
    const selected = candidates[0];
    const nextCount = count(selected.id) + 1;
    const exactAddress = exactAddressUsers.has(selected.id);
    const hasVehicleRoute = Number.isFinite(shortestVehicleRoute(selected.id));
    const approvalRequired = nextCount >= 3;
    const reason: MeasurementAssignmentResult["reason"] = approvalRequired
      ? "3건 승인 필요"
      : exactAddress ? "동일주소 묶음"
        : hasVehicleRoute && nextCount > 1 ? "근거리 묶음"
          : nextCount > 1 ? "2건 배정" : "측정자 균등배정";
    assigned.push({ ...target, userId: selected.id });
    results.push({
      targetId: target.targetId,
      measurementDate: target.measurementDate,
      userId: selected.id,
      userName: selected.name,
      publicSampleCode: selected.surveyCode,
      dailyCount: nextCount,
      approvalRequired,
      reason,
    });
  }
  return results;
}
