import type { Availability, Coordinate, ExistingAssignment, RouteMetrics, SurveyTarget } from "./types";

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
 * 호출 방향 하나에서 실제 차량 경로가 확인된 evidence만 사용한다.
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

/** 호출자가 좁힌 후보 집합에서 실제 route provider 결과를 수집한다. */
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
    const forward = await input.routes.between(asRouteEntity(left), asRouteEntity(right));
    const forwardMinutes = forward.source === "vehicle" && forward.durationMinutes != null
      ? Number(forward.durationMinutes) : null;
    const durationMinutes = forwardMinutes != null && Number.isFinite(forwardMinutes) && forwardMinutes >= 0
      ? forwardMinutes : null;
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
 * 선택한 실제 측정일의 전체 target batch를 결정론적으로 평가한다.
 * 측정 참여자·보고서 담당자 정합성, 균등성, route 비용을 lexicographic하게 비교한다.
 */
export function assignMeasurementAssignees(input: {
  targets: MeasurementAssignmentTarget[];
  users: MeasurementAssigneeUser[];
  existing?: ExistingMeasurementAssignment[];
  routeEvidence?: MeasurementVehicleRouteEvidence[];
  /** 직원 제외 일정은 측정자·공시료 배정에서도 예외 없는 hard constraint다. */
  availability?: Availability;
  /** Reverse Planner 자동모드는 두 번째 배정에 실제 이동근거를 요구한다. */
  requireRouteForSecond?: boolean;
  /** 기존 Workbench 호환용. Reverse Planner 자동모드는 false다. */
  allowThirdWithApproval?: boolean;
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
  const participantMatch = (target: MeasurementAssignmentTarget, userId: number) =>
    Number(target.measurementParticipantUserIds?.includes(userId) ?? false);
  const reportMatch = (target: MeasurementAssignmentTarget, userId: number) =>
    Number(target.reportWriterUserId === userId);

  for (const measurementDate of [...new Set(targets.map((target) => target.measurementDate))]) {
    const dateTargets = targets.filter((target) => target.measurementDate === measurementDate);
    const dateExisting = assigned.filter((item) => item.measurementDate === measurementDate);
    const availableUsers = users.filter((user) => !input.availability?.isBlocked(user.id, measurementDate));
    if (!availableUsers.length) continue;
    const initialCounts = new Map(availableUsers.map((user) => [user.id, dateExisting.filter((item) => item.userId === user.id).length]));
    type SearchState = { ids: Array<number | null>; counts: number[]; assignedCount: number;
      current: ExistingMeasurementAssignment[]; participant: number; report: number; route: number };
    const routeInfo = (target: MeasurementAssignmentTarget, userId: number, current: ExistingMeasurementAssignment[]) => {
      const sameUser = current.filter((item) => item.userId === userId);
      if (!sameUser.length) return { allowed: true, minutes: 0, exact: false, vehicle: false };
      const exact = sameUser.some((item) => normalizedAddress(item.address) && normalizedAddress(item.address) === normalizedAddress(target.address));
      if (exact) return { allowed: true, minutes: 0, exact: true, vehicle: false };
      const minutes = Math.min(...sameUser.map((item) => routeMinutes(target, item, evidence)), Number.POSITIVE_INFINITY);
      return {
        allowed: !input.requireRouteForSecond || Number.isFinite(minutes),
        // route 미확인은 legacy Workbench에서 허용할 수 있지만 objective에서는
        // 실제 route보다 항상 불리하게 평가하여 불필요한 중복을 억제한다.
        minutes: Number.isFinite(minutes) ? minutes : 1_000_000,
        exact: false,
        vehicle: Number.isFinite(minutes),
      };
    };
    const maxAutomaticCount = input.requireRouteForSecond ? 2 : 3;
    const remainingMatchUpperBound = (startIndex: number, state: SearchState, kind: "participant" | "report") => {
      const slots = availableUsers.flatMap((user, userIndex) =>
        Array.from({ length: Math.max(0, maxAutomaticCount - state.counts[userIndex]) }, (_, slotIndex) => ({
          userId: user.id, key: `${user.id}|${slotIndex}`,
        })));
      const occupiedBySlot = new Map<string, number>();
      const tryMatch = (targetIndex: number, seen: Set<string>): boolean => {
        const target = dateTargets[targetIndex];
        for (const slot of slots) {
          const matches = kind === "participant"
            ? (target.measurementParticipantUserIds?.includes(slot.userId) ?? false)
            : target.reportWriterUserId === slot.userId;
          if (!matches || seen.has(slot.key)) continue;
          seen.add(slot.key);
          const priorTargetIndex = occupiedBySlot.get(slot.key);
          if (priorTargetIndex == null || tryMatch(priorTargetIndex, seen)) {
            occupiedBySlot.set(slot.key, targetIndex);
            return true;
          }
        }
        return false;
      };
      let matched = 0;
      for (let targetIndex = startIndex; targetIndex < dateTargets.length; targetIndex += 1) {
        if (tryMatch(targetIndex, new Set())) matched += 1;
      }
      return matched;
    };
    const stateRank = (state: SearchState) => {
      const counts = state.counts;
      const total = counts.reduce((sum, count) => sum + count, 0);
      return { maxCount: Math.max(...counts, 0), variance: counts.reduce((sum, count) => sum + Math.abs(count * counts.length - total), 0),
        duplicateUsers: counts.filter((count) => count > 1).length };
    };
    const duplicateRouteFloor = (() => {
      const allTargets = [...dateTargets, ...dateExisting];
      if (allTargets.some((left, index) => allTargets.slice(index + 1).some((right) =>
        normalizedAddress(left.address) && normalizedAddress(left.address) === normalizedAddress(right.address)))) return 0;
      return Math.min(...evidence.filter((item) => item.allowed && item.source === "vehicle"
        && item.durationMinutes != null && item.fromMeasurementDate === measurementDate
        && item.toMeasurementDate === measurementDate).map((item) => item.durationMinutes as number), Number.POSITIVE_INFINITY);
    })();
    const optimisticRank = (state: SearchState, remaining: number) => {
      const counts = state.counts;
      const zeroCount = counts.filter((count) => count === 0).length;
      const addedDuplicates = Math.max(0, remaining - zeroCount);
      const route = state.route + (addedDuplicates === 0 ? 0 : addedDuplicates * duplicateRouteFloor);
      const balanced = [...counts];
      for (let step = 0; step < remaining; step += 1) {
        let selected = -1;
        for (let index = 0; index < balanced.length; index += 1) {
          if (balanced[index] >= maxAutomaticCount) continue;
          if (selected < 0 || balanced[index] < balanced[selected]) selected = index;
        }
        if (selected < 0) break;
        balanced[selected] += 1;
      }
      const total = balanced.reduce((sum, count) => sum + count, 0);
      return {
        route,
        maxCount: Math.max(...balanced, 0),
        variance: balanced.reduce((sum, count) => sum + Math.abs(count * balanced.length - total), 0),
        duplicateUsers: counts.filter((count) => count > 1).length + addedDuplicates,
      };
    };
    const compareStates = (left: SearchState, right: SearchState) => {
      if (left.participant !== right.participant) return right.participant - left.participant;
      if (left.report !== right.report) return right.report - left.report;
      if (left.route !== right.route) return left.route - right.route;
      const leftRank = stateRank(left); const rightRank = stateRank(right);
      if (leftRank.maxCount !== rightRank.maxCount) return leftRank.maxCount - rightRank.maxCount;
      if (leftRank.variance !== rightRank.variance) return leftRank.variance - rightRank.variance;
      if (leftRank.duplicateUsers !== rightRank.duplicateUsers) return leftRank.duplicateUsers - rightRank.duplicateUsers;
      if (left.ids.length !== right.ids.length) return right.ids.length - left.ids.length;
      return left.ids.map((id) => id == null ? "99999999" : id.toString().padStart(8, "0")).join("")
        .localeCompare(right.ids.map((id) => id == null ? "99999999" : id.toString().padStart(8, "0")).join(""));
    };
    let bestComplete: SearchState | null = null;
    let bestPartial: SearchState | null = null;
    const remainingParticipant = new Array(dateTargets.length + 1).fill(0);
    const remainingReport = new Array(dateTargets.length + 1).fill(0);
    for (let index = dateTargets.length - 1; index >= 0; index -= 1) {
      const item = dateTargets[index];
      remainingParticipant[index] = remainingParticipant[index + 1]
        + Math.max(...availableUsers.map((user) => participantMatch(item, user.id)), 0);
      remainingReport[index] = remainingReport[index + 1]
        + Math.max(...availableUsers.map((user) => reportMatch(item, user.id)), 0);
    }
    const visit = (index: number, state: SearchState) => {
      const assignedCount = state.assignedCount;
      const bestPartialCount = bestPartial?.assignedCount ?? -1;
      if (!bestPartial || assignedCount > bestPartialCount
        || (assignedCount === bestPartialCount && compareStates(state, bestPartial) < 0)) bestPartial = state;
      if (index === dateTargets.length) {
        if (assignedCount === dateTargets.length && (!bestComplete || compareStates(state, bestComplete) < 0)) bestComplete = state;
        return;
      }
      const assignableUpperBound = assignedCount + dateTargets.length - index;
      if (assignableUpperBound < bestPartialCount) return;
      if (!bestComplete && bestPartial && assignableUpperBound === bestPartialCount) {
        const participantUpperBound = state.participant + remainingMatchUpperBound(index, state, "participant");
        const reportUpperBound = state.report + remainingMatchUpperBound(index, state, "report");
        if (participantUpperBound < bestPartial.participant) return;
        if (participantUpperBound === bestPartial.participant && reportUpperBound < bestPartial.report) return;
        if (participantUpperBound === bestPartial.participant && reportUpperBound === bestPartial.report
          && state.route > bestPartial.route) return;
      }
      if (bestComplete) {
        const participantUpperBound = state.participant + remainingMatchUpperBound(index, state, "participant");
        const reportUpperBound = state.report + remainingMatchUpperBound(index, state, "report");
        if (participantUpperBound < bestComplete.participant) return;
        if (participantUpperBound === bestComplete.participant
          && reportUpperBound < bestComplete.report) return;
        // route는 이후 단계에서 감소하지 않는다. 상위 objective의 이론상 최대가
        // 현재 best와 같을 때에만 누적 route lower bound로 안전하게 가지치기한다.
        if (participantUpperBound === bestComplete.participant && reportUpperBound === bestComplete.report) {
          const lower = optimisticRank(state, dateTargets.length - index);
          const bestRank = stateRank(bestComplete);
          if (lower.route > bestComplete.route) return;
          if (lower.route === bestComplete.route && lower.maxCount > bestRank.maxCount) return;
          if (lower.route === bestComplete.route && lower.maxCount === bestRank.maxCount
            && lower.variance > bestRank.variance) return;
          if (lower.route === bestComplete.route && lower.maxCount === bestRank.maxCount
            && lower.variance === bestRank.variance && lower.duplicateUsers > bestRank.duplicateUsers) return;
          if (lower.route === bestComplete.route && lower.maxCount === bestRank.maxCount
            && lower.variance === bestRank.variance && lower.duplicateUsers === bestRank.duplicateUsers) {
            const bestPrefix = bestComplete.ids.slice(0, state.ids.length);
            const prefix = state.ids.map((id) => id == null ? "99999999" : id.toString().padStart(8, "0")).join("");
            const bestKey = bestPrefix.map((id) => id == null ? "99999999" : id.toString().padStart(8, "0")).join("");
            if (prefix.localeCompare(bestKey) > 0) return;
          }
        }
      }
      const target = dateTargets[index];
      const candidates = availableUsers.map((user) => ({
        user,
        participant: participantMatch(target, user.id),
        report: reportMatch(target, user.id),
        route: routeInfo(target, user.id, state.current),
      })).filter((item) => item.route.allowed)
        .sort((left, right) => right.participant - left.participant || right.report - left.report
          || left.route.minutes - right.route.minutes || left.user.id - right.user.id);
      for (const candidate of candidates) {
        const user = candidate.user;
        const userIndex = availableUsers.findIndex((item) => item.id === user.id);
        const priorCount = state.counts[userIndex];
        if (priorCount >= maxAutomaticCount) continue;
        if (input.requireRouteForSecond && input.allowThirdWithApproval === false && priorCount >= 2) continue;
        const sameAddressException = state.current.some((item) => item.userId === user.id
          && normalizedAddress(item.address)
          && normalizedAddress(item.address) === normalizedAddress(target.address));
        if (priorCount >= 1 && state.counts.some((count) => count === 0) && !sameAddressException) continue;
        const routeData = candidate.route;
        const counts = [...state.counts];
        counts[userIndex] += 1;
        visit(index + 1, {
          ids: [...state.ids, user.id],
          counts,
          assignedCount: state.assignedCount + 1,
          current: [...state.current, { ...target, userId: user.id }],
          participant: state.participant + participantMatch(target, user.id),
          report: state.report + reportMatch(target, user.id),
          route: state.route + routeData.minutes,
        });
      }
      // 완전해가 없을 때만 이 target을 unresolved로 남기고 뒤 target을 계속 탐색한다.
      if (!bestComplete) visit(index + 1, { ...state, ids: [...state.ids, null] });
    };
    const initialState: SearchState = { ids: [], counts: availableUsers.map((user) => initialCounts.get(user.id) ?? 0),
      assignedCount: 0, current: dateExisting, participant: 0, report: 0, route: 0 };
    if (input.requireRouteForSecond === true && dateTargets.length <= 9) {
      // Reverse Planner의 정상 업무량(최대 9건)은 완전 열거하여 global optimum을 보장한다.
      visit(0, initialState);
    } else {
      // 기존 Workbench 호환량이 더 큰 경우에는 bounded search로 비용을 제한한다.
      let states: SearchState[] = [initialState];
      for (const target of dateTargets) {
        const expanded: SearchState[] = [];
        for (const state of states) {
          for (const user of availableUsers) {
            const userIndex = availableUsers.findIndex((item) => item.id === user.id);
            const priorCount = state.counts[userIndex];
            if (priorCount >= maxAutomaticCount) continue;
            const sameAddressException = state.current.some((item) => item.userId === user.id
              && normalizedAddress(item.address)
              && normalizedAddress(item.address) === normalizedAddress(target.address));
            if (priorCount >= 1 && state.counts.some((count) => count === 0) && !sameAddressException) continue;
            const routeData = routeInfo(target, user.id, state.current);
            if (!routeData.allowed) continue;
            const counts = [...state.counts];
            counts[userIndex] += 1;
            expanded.push({ ids: [...state.ids, user.id], counts, assignedCount: state.assignedCount + 1,
              current: [...state.current, { ...target, userId: user.id }],
              participant: state.participant + participantMatch(target, user.id), report: state.report + reportMatch(target, user.id), route: state.route + routeData.minutes });
          }
        }
        if (!expanded.length) {
          bestPartial = states.reduce<SearchState | null>((best, state) => !best || compareStates(state, best) < 0 ? state : best, null);
          states = [];
          break;
        }
        states = expanded.sort(compareStates).slice(0, 256);
      }
      bestComplete = states
        .filter((state) => state.ids.length === dateTargets.length && state.ids.every((id) => id != null))
        .reduce<SearchState | null>((best, state) => !best || compareStates(state, best) < 0 ? state : best, null);
      bestPartial = states.length ? states.sort((left, right) => {
        const leftCount = left.assignedCount;
        const rightCount = right.assignedCount;
        return leftCount === rightCount ? compareStates(left, right) : rightCount - leftCount;
      })[0] ?? null : bestPartial;
    }
    const best = bestComplete;
    if (!best) {
      const minimumDailyCount = Math.min(...availableUsers.map((user) => initialCounts.get(user.id) ?? 0));
      if (!input.requireRouteForSecond && input.allowThirdWithApproval !== false && minimumDailyCount >= 3) {
        throw new MeasurementAssignmentDailyLimitError(dateTargets[0]?.targetId ?? 0, measurementDate, availableUsers[0].id);
      }
      if (input.requireRouteForSecond) {
        const partial = bestPartial ?? { ids: [], counts: initialState.counts, assignedCount: 0,
          current: dateExisting, participant: 0, report: 0, route: 0 };
        const partialCounts = new Map(initialCounts);
        partial.ids.forEach((userId, index) => {
          if (userId == null) return;
          const target = dateTargets[index];
          const user = availableUsers.find((candidate) => candidate.id === userId);
          if (!user) return;
          const route = routeInfo(target, user.id, assigned.filter((item) => item.measurementDate === measurementDate));
          const dailyCount = (partialCounts.get(user.id) ?? 0) + 1;
          const reason: MeasurementAssignmentResult["reason"] = dailyCount >= 3 ? "3건 승인 필요"
            : route.exact ? "동일주소 묶음" : dailyCount > 1 && route.vehicle ? "근거리 묶음"
              : dailyCount > 1 ? "2건 배정" : "측정자 균등배정";
          assigned.push({ ...target, userId: user.id });
          partialCounts.set(user.id, dailyCount);
          results.push({ targetId: target.targetId, measurementDate, userId: user.id, userName: user.name,
            publicSampleCode: user.surveyCode, dailyCount, approvalRequired: dailyCount >= 3, reason });
        });
      }
      continue;
    }
    const outputCounts = new Map(initialCounts);
    dateTargets.forEach((target, index) => {
      const assignedUserId = best!.ids[index];
      if (assignedUserId == null) return;
      const user = availableUsers.find((candidate) => candidate.id === assignedUserId);
      if (!user) return;
      const sameDate = assigned.filter((item) => item.measurementDate === measurementDate);
      const nextCount = (outputCounts.get(user.id) ?? 0) + 1;
      const route = routeInfo(target, user.id, sameDate);
      const reason: MeasurementAssignmentResult["reason"] = nextCount >= 3
        ? "3건 승인 필요"
        : route.exact
          ? "동일주소 묶음"
          : nextCount > 1 && route.vehicle
            ? "근거리 묶음"
            : nextCount > 1 ? "2건 배정" : "측정자 균등배정";
      assigned.push({ ...target, userId: user.id });
      outputCounts.set(user.id, nextCount);
      results.push({ targetId: target.targetId, measurementDate, userId: user.id, userName: user.name, publicSampleCode: user.surveyCode, dailyCount: nextCount, approvalRequired: nextCount >= 3, reason });
    });
  }
  return results;
}
