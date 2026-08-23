/**
 * 예비조사 V2 주소 기반 일정 묶음 추천 (순수 계산)
 *
 * 원칙:
 * - 예비조사는 사업장 단위 1회. 호출자가 현재 업체 유형 정책으로 계산한 candidateDates만 묶음에 사용한다.
 * - 같은 예비조사자가 가까운 지역 사업장을 같은 날짜에 묶는 것을 기본으로 한다.
 * - 주소만 가깝다는 이유로 날짜 조건을 무시하지 않는다 (날짜 교집합 필수).
 * - 신규/최초/타기관 신규는 현장 예비조사 전제, 기존 사업장은 유선 가능성을 존중한다.
 * - 예·측은 사업장별 독립 계산(예비조사자 ∩ 실제 측정자). 묶음 전체에 예·측 하나를 공통 지정하지 않는다.
 * - 이 함수는 추천 결과만 만들며, 운영 데이터를 저장하지 않는다.
 */

export const GROUP_PROXIMITY_KM = 10;

export interface GroupTargetCoordinate {
  latitude: number;
  longitude: number;
}

export interface GroupRecommendationTarget {
  id: number;
  code: string;
  name: string;
  kind: "new" | "existing";
  measurementDate: string;
  address: string | null;
  /** 행정구역 prefix (예: "대전 대덕구") */
  region: string | null;
  coordinate: GroupTargetCoordinate | null;
  /** 실제 측정자 이름 목록 */
  staffNames: string[];
  /** 예비조사 lead(예·측 후보) 사용자 id/이름 */
  leadUserId: number | null;
  leadName: string | null;
  /** 가능한 예비조사일 (primary→fallback 순) */
  candidateDates: string[];
}

export interface GroupRecommendationItem {
  id: number;
  code: string;
  name: string;
  kind: "new" | "existing";
  measurementDate: string;
  address: string | null;
  /** 예·측 후보 = 예비조사자 ∩ 실제 측정자 (사업장별 독립) */
  linkCandidates: string[];
}

export interface RecommendationGroup {
  /** 묶음 예비조사일 */
  date: string;
  /** 예비조사자(lead) */
  surveyorUserId: number | null;
  surveyorName: string | null;
  items: GroupRecommendationItem[];
}

export interface BlockedRecommendation {
  id: number;
  code: string;
  name: string;
  reason: "NO_AVAILABLE_DATE_THROUGH_MINUS_3" | "NO_SURVEYOR";
}

export interface GroupRecommendationOutput {
  groups: RecommendationGroup[];
  blocked: BlockedRecommendation[];
}

function haversineKm(left: GroupTargetCoordinate, right: GroupTargetCoordinate): number {
  const radians = (value: number) => value * Math.PI / 180;
  const lat = radians(right.latitude - left.latitude);
  const lng = radians(right.longitude - left.longitude);
  const a = Math.sin(lat / 2) ** 2 +
    Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 두 사업장의 근접성.
 * - 좌표가 둘 다 있으면 좌표 거리(GROUP_PROXIMITY_KM 이내).
 * - 좌표가 없으면 행정구역(region) 동일 여부로 판단.
 * - 가짜 좌표를 만들지 않는다.
 */
export function areTargetsNearby(
  left: Pick<GroupRecommendationTarget, "coordinate" | "region">,
  right: Pick<GroupRecommendationTarget, "coordinate" | "region">,
): boolean {
  if (left.coordinate && right.coordinate) {
    return haversineKm(left.coordinate, right.coordinate) <= GROUP_PROXIMITY_KM;
  }
  return Boolean(left.region && left.region === right.region);
}

/** 가능한 예비조사일 교집합 여부 */
export function sharesAvailableDate(left: GroupRecommendationTarget, right: GroupRecommendationTarget): boolean {
  const rightSet = new Set(right.candidateDates);
  return left.candidateDates.some((date) => rightSet.has(date));
}

/**
 * 주소 근접 + 가능 날짜 + 예비조사 인력 기준 묶음 추천.
 *
 * 그룹화 규칙:
 * - 같은 예비조사자(lead)를 가진 사업장 중, 가능 날짜가 겹치고 서로 가까운 사업장을 같은 날짜로 묶는다.
 * - 다른 예비조사자를 단순히 주소만 보고 강제로 같은 일정에 넣지 않는다.
 * - 하나의 사업장은 하나의 활성 그룹에만 들어간다 (중복 추천 없음, idempotent).
 * - 기존 사업장은 유선 가능성이 있어 동일 날짜 자체를 금지하지 않는다.
 */
export function buildGroupRecommendation(input: GroupRecommendationTarget[]): GroupRecommendationOutput {
  const schedulable = input.filter((target) => target.candidateDates.length > 0 && target.leadUserId != null);
  const blocked: BlockedRecommendation[] = [
    ...input
      .filter((target) => target.candidateDates.length === 0)
      .map((target) => ({
        id: target.id, code: target.code, name: target.name,
        reason: "NO_AVAILABLE_DATE_THROUGH_MINUS_3" as const,
      })),
    ...input
      .filter((target) => target.candidateDates.length > 0 && target.leadUserId == null)
      .map((target) => ({
        id: target.id, code: target.code, name: target.name,
        reason: "NO_SURVEYOR" as const,
      })),
  ];

  // 전역 가능 날짜 공간 (primary→fallback 순서 유지)
  const dateSpace = [...new Set(schedulable.flatMap((target) => target.candidateDates))];

  const groups: RecommendationGroup[] = [];
  const assigned = new Set<number>();

  const toItem = (target: GroupRecommendationTarget): GroupRecommendationItem => ({
    id: target.id,
    code: target.code,
    name: target.name,
    kind: target.kind,
    measurementDate: target.measurementDate,
    address: target.address,
    linkCandidates: target.leadName && target.staffNames.includes(target.leadName) ? [target.leadName] : [],
  });

  // 1단계: 가능 날짜가 겹치는 가까운 사업장을 같은 날짜로 묶는다 (2건 이상 그룹 우선).
  // 같은 예비조사자(lead)를 가진 사업장만 그룹으로 묶으며, 날짜 교집합이 없으면 강제하지 않는다.
  for (const date of dateSpace) {
    const bySurveyor = new Map<number, GroupRecommendationTarget[]>();
    for (const target of schedulable) {
      if (assigned.has(target.id)) continue;
      if (!target.candidateDates.includes(date)) continue;
      if (target.leadUserId == null) continue;
      const bucket = bySurveyor.get(target.leadUserId) ?? [];
      bucket.push(target);
      bySurveyor.set(target.leadUserId, bucket);
    }
    for (const [surveyorUserId, pool] of bySurveyor) {
      const remaining = [...pool];
      while (remaining.length) {
        const seed = remaining.shift() as GroupRecommendationTarget;
        const groupTargets = [seed];
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          if (areTargetsNearby(seed, remaining[index])) {
            groupTargets.push(remaining.splice(index, 1)[0]);
          }
        }
        if (groupTargets.length < 2) continue; // 단독은 2단계에서 자신의 최적 날짜로 처리
        groupTargets.forEach((target) => assigned.add(target.id));
        groups.push({
          date,
          surveyorUserId,
          surveyorName: seed.leadName,
          items: groupTargets.map(toItem),
        });
      }
    }
  }

  // 2단계: 그룹에 못 들어간 사업장은 자신의 최적 날짜로 단독 추천
  for (const target of schedulable) {
    if (assigned.has(target.id)) continue;
    assigned.add(target.id);
    groups.push({
      date: target.candidateDates[0],
      surveyorUserId: target.leadUserId,
      surveyorName: target.leadName,
      items: [toItem(target)],
    });
  }

  groups.sort((left, right) => left.date.localeCompare(right.date) || String(left.surveyorName).localeCompare(String(right.surveyorName)));
  return { groups, blocked };
}
