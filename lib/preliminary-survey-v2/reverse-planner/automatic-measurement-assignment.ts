import {
  assignMeasurementAssignees,
  type ExistingMeasurementAssignment,
  type MeasurementAssignmentTarget,
  type MeasurementVehicleRouteEvidence,
  type SurveyCode,
} from "../measurement-assignment";
import { createRouteMetrics } from "../route-metrics";
import type { Coordinate, RouteMetrics } from "../types";
import type {
  FixedMeasurementAssignment,
  PlannerRouteEvidence,
  PlanningSnapshot,
} from "./types";

const surveyCodes = new Set(["A", "B", "C", "D", "F", "G"]);
const DEFAULT_MAX_PAIRS = 36;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_DEADLINE_MS = 20_000;

type AutomaticInput = {
  missing: MeasurementAssignmentTarget[];
  existing: ExistingMeasurementAssignment[];
  explicit: ExistingMeasurementAssignment[];
};

export type AutomaticMeasurementAssignmentOptions = {
  routes?: RouteMetrics;
  loadCoordinates?: (businessCodes: string[]) => Promise<Map<string, Coordinate>>;
  maxPairs?: number;
  concurrency?: number;
  deadlineMs?: number;
};

const keyOf = (targetId: number, measurementDate: string) => `${targetId}|${measurementDate}`;
const normalizedAddress = (value: string | null | undefined) => String(value ?? "").replace(/\s+/g, "").trim();

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function automaticInput(snapshot: PlanningSnapshot): AutomaticInput {
  const planningKeys = new Set(snapshot.targets.flatMap((target) =>
    target.days.map((day) => keyOf(target.id, day.date))));
  const missing = snapshot.targets.flatMap((target) => target.days
    .filter((day) => !target.fixedAssignments.some((fixed) =>
      fixed.origin !== "automatic" && fixed.measurementDate === day.date))
    .map((day) => ({
      targetId: target.id,
      measurementDate: day.date,
      address: target.address,
      coordinate: target.coordinate ?? null,
      businessCode: target.code,
      reportWriterUserId: day.reportWriterUserId,
      measurementParticipantUserIds: day.collaboratorUserIds,
    })));
  const explicit = snapshot.targets.flatMap((target) => target.fixedAssignments
    .filter((fixed) => fixed.origin !== "automatic")
    .map((fixed) => ({
      targetId: target.id,
      measurementDate: fixed.measurementDate,
      address: target.address,
      coordinate: target.coordinate ?? null,
      businessCode: target.code,
      userId: fixed.assigneeUserId,
    })));
  const occupancyByTarget = new Map(snapshot.actualMeasurementOccupancy.map((item) => [item.targetId, item]));
  const existing = snapshot.existingPublicSampleAssignments
    .filter((item) => !planningKeys.has(keyOf(item.targetId, item.measurementDate)))
    .map((item) => ({
      targetId: item.targetId,
      measurementDate: item.measurementDate,
      address: occupancyByTarget.get(item.targetId)?.address ?? null,
      coordinate: occupancyByTarget.get(item.targetId)?.coordinate ?? null,
      businessCode: item.businessCode,
      userId: item.assigneeUserId,
    }));
  return { missing, explicit, existing };
}

function measurementEvidence(evidence: PlannerRouteEvidence[]): MeasurementVehicleRouteEvidence[] {
  return evidence
    .filter((item) => item.routeReason === "MEASUREMENT_ASSIGNEE_SECOND_ASSIGNMENT")
    .map((item) => ({
      fromTargetId: item.leftTargetId,
      fromMeasurementDate: item.date,
      toTargetId: item.rightTargetId,
      toMeasurementDate: item.date,
      source: item.sameAddress || item.provider === "vehicle" || item.provider === "vehicle_bidirectional"
        ? "vehicle" as const : "unknown" as const,
      durationMinutes: item.durationMinutes,
      allowed: item.sameAddress || (item.durationMinutes != null && item.durationMinutes <= 60),
    }));
}

function calculateAutomatic(snapshot: PlanningSnapshot, routeEvidence: PlannerRouteEvidence[]) {
  const input = automaticInput(snapshot);
  const automatic = assignMeasurementAssignees({
    targets: input.missing,
    users: snapshot.users.map((user) => ({
      id: user.id,
      name: user.name,
      surveyCode: surveyCodes.has(user.baseCode ?? "") ? user.baseCode as SurveyCode : null,
      active: user.active,
    })),
    existing: [...input.existing, ...input.explicit],
    routeEvidence: measurementEvidence(routeEvidence),
    availability: {
      isBlocked: (userId, date) => snapshot.scheduleBlocks.some((block) =>
        block.userId === userId && block.startDate <= date && block.endDate >= date),
    },
    requireRouteForSecond: true,
    allowThirdWithApproval: false,
  });
  return { input, automatic };
}

/**
 * 명시적으로 고정되지 않은 측정일만 결정론적 측정자 배정기로 채운다.
 * 자동값은 계산용이며 fixed confirmation row로 저장하지 않는다.
 */
export function withAutomaticMeasurementAssignments(
  snapshot: PlanningSnapshot,
  routeEvidence: PlannerRouteEvidence[] = snapshot.routeEvidence,
): PlanningSnapshot {
  return withCalculatedAutomaticAssignments(snapshot, routeEvidence, calculateAutomatic(snapshot, routeEvidence));
}

function withCalculatedAutomaticAssignments(
  snapshot: PlanningSnapshot,
  routeEvidence: PlannerRouteEvidence[],
  calculation: ReturnType<typeof calculateAutomatic>,
): PlanningSnapshot {
  const { input, automatic } = calculation;
  if (!input.missing.length) return { ...snapshot, routeEvidence };
  const automaticAssignments: FixedMeasurementAssignment[] = automatic.map((item) => ({
    targetId: item.targetId,
    measurementDate: item.measurementDate,
    assigneeUserId: item.userId,
    confirmedAt: "automatic-preview",
    updatedAt: "automatic-preview",
    origin: "automatic" as const,
  }));
  const automaticByTarget = new Map<number, FixedMeasurementAssignment[]>();
  for (const assignment of automaticAssignments) {
    automaticByTarget.set(assignment.targetId, [
      ...(automaticByTarget.get(assignment.targetId) ?? []), assignment,
    ]);
  }
  const resolvedKeys = new Set(automaticAssignments.map((item) => keyOf(item.targetId, item.measurementDate)));
  const allAssigned = [...input.existing, ...input.explicit, ...automatic.map((item) => ({
    ...input.missing.find((target) => keyOf(target.targetId, target.measurementDate)
      === keyOf(item.targetId, item.measurementDate))!,
    userId: item.userId,
  }))];
  const activeUsers = snapshot.users.filter((user) => user.active && surveyCodes.has(user.baseCode ?? ""));
  const targets = snapshot.targets.map((target) => {
    const unresolved = target.days.filter((day) =>
      !target.fixedAssignments.some((fixed) => fixed.origin !== "automatic" && fixed.measurementDate === day.date)
      && !resolvedKeys.has(keyOf(target.id, day.date)));
    let automaticAssignmentIssue: PlanningSnapshot["targets"][number]["automaticAssignmentIssue"];
    if (unresolved.length) {
      const exceedsCapacity = unresolved.some((day) => {
        const available = activeUsers.filter((user) => !snapshot.scheduleBlocks.some((block) =>
          block.userId === user.id && block.startDate <= day.date && block.endDate >= day.date));
        return available.length > 0 && available.every((user) =>
          allAssigned.filter((item) => item.measurementDate === day.date && item.userId === user.id).length >= 3);
      });
      const requiresThird = unresolved.some((day) => {
        const available = activeUsers.filter((user) => !snapshot.scheduleBlocks.some((block) =>
          block.userId === user.id && block.startDate <= day.date && block.endDate >= day.date));
        return available.length > 0 && available.every((user) =>
          allAssigned.filter((item) => item.measurementDate === day.date && item.userId === user.id).length >= 2);
      });
      automaticAssignmentIssue = exceedsCapacity
        ? "MEASUREMENT_ASSIGNMENT_CAPACITY_EXCEEDED"
        : requiresThird
          ? "MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE"
          : "MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED";
    }
    return {
      ...target,
      automaticAssignmentIssue,
      fixedAssignments: [
        ...target.fixedAssignments.filter((fixed) => fixed.origin !== "automatic"),
        ...(automaticByTarget.get(target.id) ?? []),
      ].sort((left, right) => left.measurementDate.localeCompare(right.measurementDate)),
    };
  });
  const automaticByDay = new Map(automaticAssignments.map((item) => [
    keyOf(item.targetId, item.measurementDate), item.assigneeUserId,
  ]));
  const actualMeasurementOccupancy = snapshot.actualMeasurementOccupancy.map((item) => {
    const automaticUserId = automaticByDay.get(keyOf(item.targetId, item.date));
    return automaticUserId == null ? item : {
      ...item,
      participantUserIds: [...new Set([...item.participantUserIds, automaticUserId])]
        .sort((left, right) => left - right),
    };
  });
  return { ...snapshot, routeEvidence, targets, actualMeasurementOccupancy };
}

type CandidatePair = {
  date: string;
  left: MeasurementAssignmentTarget;
  right: ExistingMeasurementAssignment;
  userIds: number[];
};

async function settleBeforeDeadline<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return { timedOut: true as const };
  return new Promise<{ timedOut: false; value: T } | { timedOut: true }>((resolve, reject) => {
    const onAbort = () => resolve({ timedOut: true });
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => resolve({ timedOut: false, value }), reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Preview 전용: exact search에서 실제 두 번째 배정이 될 수 있는 pair만 단방향 조회한다. */
export async function resolveAutomaticMeasurementAssignments(
  snapshot: PlanningSnapshot,
  options: AutomaticMeasurementAssignmentOptions = {},
) {
  const input = automaticInput(snapshot);
  const assigned = [...input.existing, ...input.explicit];
  const pairs = new Map<string, CandidatePair>();
  const activeUsers = snapshot.users.filter((item) => item.active && surveyCodes.has(item.baseCode ?? ""));
  const addPair = (left: MeasurementAssignmentTarget, right: ExistingMeasurementAssignment, userIds: number[]) => {
    if (!userIds.length || left.measurementDate !== right.measurementDate || left.targetId === right.targetId) return;
    const ids = [left.targetId, right.targetId].sort((a, b) => a - b);
    const key = `${left.measurementDate}|${ids[0]}|${ids[1]}`;
    const previous = pairs.get(key);
    pairs.set(key, { date: left.measurementDate, left, right,
      userIds: [...new Set([...(previous?.userIds ?? []), ...userIds])].sort((a, b) => a - b) });
  };
  for (const date of [...new Set(input.missing.map((item) => item.measurementDate))]) {
    const targets = input.missing.filter((item) => item.measurementDate === date)
      .sort((left, right) => left.targetId - right.targetId);
    const users = activeUsers.filter((user) => !snapshot.scheduleBlocks.some((block) =>
      block.userId === user.id && block.startDate <= date && block.endDate >= date));
    const occupancy = new Map(users.map((user) => [user.id,
      assigned.filter((item) => item.measurementDate === date && item.userId === user.id)]));
    const initialCounts = new Map(users.map((user) => [user.id, occupancy.get(user.id)?.length ?? 0]));
    for (const [index, left] of targets.entries()) {
      for (const right of targets.slice(index + 1)) {
        if (!normalizedAddress(left.address)
          || normalizedAddress(left.address) !== normalizedAddress(right.address)) continue;
        addPair(left, { ...right, userId: 0 }, users.filter((user) => (initialCounts.get(user.id) ?? 0) === 0)
          .map((user) => user.id));
      }
      for (const right of assigned.filter((item) => item.measurementDate === date
        && normalizedAddress(item.address)
        && normalizedAddress(item.address) === normalizedAddress(left.address))) {
        if ((initialCounts.get(right.userId) ?? 0) === 1) addPair(left, right, [right.userId]);
      }
    }
    const remainingParticipant = new Array(targets.length + 1).fill(0);
    const remainingReport = new Array(targets.length + 1).fill(0);
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      remainingParticipant[index] = remainingParticipant[index + 1]
        + Math.max(...users.map((user) => Number(targets[index].measurementParticipantUserIds?.includes(user.id) ?? false)), 0);
      remainingReport[index] = remainingReport[index + 1]
        + Math.max(...users.map((user) => Number(targets[index].reportWriterUserId === user.id)), 0);
    }
    let bestParticipant = -1;
    let bestReport = -1;
    const bestPairs = new Map<string, CandidatePair>();
    const firstRotationValid = () => {
      const counts = users.map((user) => occupancy.get(user.id)?.length ?? 0);
      if (!counts.some((count) => count === 0)) return true;
      return users.every((user, userIndex) => {
        const initialCount = initialCounts.get(user.id) ?? 0;
        if (counts[userIndex] <= Math.max(initialCount, 1)) return true;
        const sameUser = occupancy.get(user.id) ?? [];
        return sameUser.length === 2 && normalizedAddress(sameUser[0].address)
          && normalizedAddress(sameUser[0].address) === normalizedAddress(sameUser[1].address);
      });
    };
    const canStillSatisfyFirstRotation = (remainingTargets: number) => {
      const counts = users.map((user) => occupancy.get(user.id)?.length ?? 0);
      const zeroCount = counts.filter((count) => count === 0).length;
      if (zeroCount === 0) return true;
      const hasOrdinaryDuplicate = users.some((user, userIndex) => {
        const initialCount = initialCounts.get(user.id) ?? 0;
        if (counts[userIndex] <= Math.max(initialCount, 1)) return false;
        const sameUser = occupancy.get(user.id) ?? [];
        return sameUser.length !== 2 || !normalizedAddress(sameUser[0].address)
          || normalizedAddress(sameUser[0].address) !== normalizedAddress(sameUser[1].address);
      });
      return !hasOrdinaryDuplicate || zeroCount <= remainingTargets;
    };
    const mergeBestPair = (pair: CandidatePair) => {
      const ids = [pair.left.targetId, pair.right.targetId].sort((left, right) => left - right);
      const key = `${pair.date}|${ids[0]}|${ids[1]}`;
      const previous = bestPairs.get(key);
      bestPairs.set(key, { ...pair,
        userIds: [...new Set([...(previous?.userIds ?? []), ...pair.userIds])].sort((left, right) => left - right) });
    };
    const explore = (index: number, participant: number, report: number, pathPairs: CandidatePair[]) => {
      if (!canStillSatisfyFirstRotation(targets.length - index)) return;
      if (participant + remainingParticipant[index] < bestParticipant) return;
      if (participant + remainingParticipant[index] === bestParticipant
        && report + remainingReport[index] < bestReport) return;
      if (index >= targets.length) {
        if (!firstRotationValid()) return;
        if (participant > bestParticipant || (participant === bestParticipant && report > bestReport)) {
          bestParticipant = participant;
          bestReport = report;
          bestPairs.clear();
        }
        if (participant === bestParticipant && report === bestReport) pathPairs.forEach(mergeBestPair);
        return;
      }
      const target = targets[index];
      const candidates = [...users].sort((left, right) =>
        Number(target.measurementParticipantUserIds?.includes(right.id) ?? false)
          - Number(target.measurementParticipantUserIds?.includes(left.id) ?? false)
        || Number(target.reportWriterUserId === right.id) - Number(target.reportWriterUserId === left.id)
        || left.id - right.id);
      for (const user of candidates) {
        const prior = occupancy.get(user.id) ?? [];
        if (prior.length >= 2) continue;
        const nextPairs = prior.length === 1
          ? [...pathPairs, { date, left: target, right: prior[0], userIds: [user.id] }]
          : pathPairs;
        occupancy.set(user.id, [...prior, { ...target, userId: user.id }]);
        explore(index + 1,
          participant + Number(target.measurementParticipantUserIds?.includes(user.id) ?? false),
          report + Number(target.reportWriterUserId === user.id), nextPairs);
        occupancy.set(user.id, prior);
      }
    };
    explore(0, 0, 0, []);
    bestPairs.forEach((pair) => addPair(pair.left, pair.right, pair.userIds));
  }
  const maxPairs = positiveInteger(options.maxPairs
    ?? process.env.REVERSE_PLANNER_ROUTE_MAX_PAIRS, DEFAULT_MAX_PAIRS);
  const evidence = [...snapshot.routeEvidence];
  const candidates = [...pairs.values()].sort((left, right) => left.date.localeCompare(right.date)
    || left.left.targetId - right.left.targetId || left.right.targetId - right.right.targetId);
  if (!candidates.length) {
    return {
      snapshot: withAutomaticMeasurementAssignments(snapshot, evidence),
      routeEvidence: evidence,
      requiredPairs: 0,
    };
  }
  const external = candidates.filter((pair) => {
    const sameAddress = normalizedAddress(pair.left.address)
      && normalizedAddress(pair.left.address) === normalizedAddress(pair.right.address);
    if (sameAddress) {
      evidence.push(routeEvidenceFor(pair, 0, "same_address", 0, 0));
      return false;
    }
    return true;
  });
  if (external.length > maxPairs) {
    const unresolvedKeys = new Set(input.missing.map((target) => keyOf(target.targetId, target.measurementDate)));
    return {
      snapshot: {
        ...snapshot,
        routeEvidence: evidence,
        targets: snapshot.targets.map((target) => ({
          ...target,
          automaticAssignmentIssue: target.days.some((day) => unresolvedKeys.has(keyOf(target.id, day.date)))
            ? "MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED"
            : target.automaticAssignmentIssue,
          fixedAssignments: target.fixedAssignments.filter((fixed) => fixed.origin !== "automatic"),
        })),
      },
      routeEvidence: evidence,
      requiredPairs: external.length,
    };
  }
  const locationByCode = new Map<string, Coordinate>();
  if (options.loadCoordinates && external.length) {
    const codes = [...new Set(external.flatMap((pair) => [pair.left.businessCode, pair.right.businessCode])
      .filter((code): code is string => Boolean(code)))];
    const loaded = await options.loadCoordinates(codes);
    loaded.forEach((coordinate, code) => locationByCode.set(code, coordinate));
  }
  const routes = options.routes ?? createRouteMetrics();
  const deadlineMs = positiveInteger(options.deadlineMs
    ?? process.env.REVERSE_PLANNER_ROUTE_DEADLINE_MS, DEFAULT_DEADLINE_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let index = 0;
  const workers = Array.from({ length: Math.min(positiveInteger(options.concurrency
    ?? process.env.REVERSE_PLANNER_ROUTE_CONCURRENCY, DEFAULT_CONCURRENCY), external.length) }, async () => {
    while (index < external.length) {
      const pair = external[index++];
      if (controller.signal.aborted) {
        evidence.push(routeEvidenceFor(pair, null, "route_deadline", null, null));
        continue;
      }
      const left = { coordinate: pair.left.coordinate ?? locationByCode.get(pair.left.businessCode ?? "") ?? null, region: null } as any;
      const right = { coordinate: pair.right.coordinate ?? locationByCode.get(pair.right.businessCode ?? "") ?? null, region: null } as any;
      const settled = await settleBeforeDeadline(routes.between(left, right, { signal: controller.signal }), controller.signal);
      if (settled.timedOut) {
        evidence.push(routeEvidenceFor(pair, null, "route_deadline", null, null));
        continue;
      }
      const forwardMinutes = settled.value.source === "vehicle" ? settled.value.durationMinutes : null;
      evidence.push(routeEvidenceFor(pair, forwardMinutes, forwardMinutes != null ? "vehicle" : "route_unavailable",
        forwardMinutes, null));
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    clearTimeout(timer);
  }
  const sortedEvidence = evidence.sort((left, right) => left.date.localeCompare(right.date)
    || left.leftTargetId - right.leftTargetId || left.rightTargetId - right.rightTargetId);
  return {
    snapshot: withAutomaticMeasurementAssignments(snapshot, sortedEvidence),
    routeEvidence: sortedEvidence,
    requiredPairs: external.length,
  };
}

function routeEvidenceFor(
  pair: CandidatePair,
  durationMinutes: number | null,
  provider: string,
  forwardDurationMinutes: number | null,
  reverseDurationMinutes: number | null,
): PlannerRouteEvidence {
  const [leftTargetId, rightTargetId] = [pair.left.targetId, pair.right.targetId].sort((a, b) => a - b);
  return {
    date: pair.date,
    leftTargetId,
    rightTargetId,
    sameAddress: provider === "same_address",
    durationMinutes,
    effectiveDurationMinutes: durationMinutes,
    forwardDurationMinutes,
    reverseDurationMinutes,
    forwardProvider: provider,
    reverseProvider: provider,
    provider,
    capturedAt: new Date().toISOString(),
    routeReason: "MEASUREMENT_ASSIGNEE_SECOND_ASSIGNMENT",
    sharedUserIds: pair.userIds,
  };
}
