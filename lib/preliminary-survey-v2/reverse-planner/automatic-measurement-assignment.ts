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
  const activeUsers = snapshot.users.filter((item) => item.active && surveyCodes.has(item.baseCode ?? ""));
  const pairKey = (pair: CandidatePair) => {
    const ids = [pair.left.targetId, pair.right.targetId].sort((a, b) => a - b);
    return `${pair.date}|${ids[0]}|${ids[1]}`;
  };
  type CandidateTier = { sameAddress: number; participant: number; report: number;
    pairs: CandidatePair[]; exhaustive: boolean };
  const findNextTier = (date: string, ceiling: CandidateTier | null, requiredSameAddress: number | null,
    exactRole: Pick<CandidateTier, "participant" | "report"> | null = null) => {
    const targets = input.missing.filter((item) => item.measurementDate === date)
      .sort((left, right) => left.targetId - right.targetId);
    const users = activeUsers.filter((user) => !snapshot.scheduleBlocks.some((block) =>
      block.userId === user.id && block.startDate <= date && block.endDate >= date));
    const exhaustive = targets.length <= 7;
    const occupancy = new Map(users.map((user) => [user.id,
      assigned.filter((item) => item.measurementDate === date && item.userId === user.id)]));
    const initialCounts = new Map(users.map((user) => [user.id, occupancy.get(user.id)?.length ?? 0]));
    const remainingMatchUpperBound = (startIndex: number, kind: "participant" | "report") => {
      const slots = users.flatMap((user) => Array.from({ length: Math.max(0, 2 - (occupancy.get(user.id)?.length ?? 0)) },
        (_, slotIndex) => ({ userId: user.id, key: `${user.id}|${slotIndex}` })));
      const occupiedBySlot = new Map<string, number>();
      const tryMatch = (targetIndex: number, seen: Set<string>): boolean => {
        const target = targets[targetIndex];
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
      for (let targetIndex = startIndex; targetIndex < targets.length; targetIndex += 1) {
        if (tryMatch(targetIndex, new Set())) matched += 1;
      }
      return matched;
    };
    let bestSameAddress = requiredSameAddress ?? -1;
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
    const sameAddressUpperBound = (startIndex: number, sameAddress: number) => {
      const remainingByAddress = new Map<string, number>();
      for (const target of targets.slice(startIndex)) {
        const key = normalizedAddress(target.address);
        if (key) remainingByAddress.set(key, (remainingByAddress.get(key) ?? 0) + 1);
      }
      let additional = 0;
      for (const [key, remainingCount] of remainingByAddress) {
        const eligibleSingles = users.filter((user) => (occupancy.get(user.id)?.length ?? 0) < 2
          && (occupancy.get(user.id) ?? []).some((item) => normalizedAddress(item.address) === key)).length;
        const matchedSingles = Math.min(remainingCount, eligibleSingles);
        additional += matchedSingles + Math.floor((remainingCount - matchedSingles) / 2);
      }
      return sameAddress + additional;
    };
    const mergeBestPair = (pair: CandidatePair) => {
      const ids = [pair.left.targetId, pair.right.targetId].sort((left, right) => left - right);
      const key = `${pair.date}|${ids[0]}|${ids[1]}`;
      const previous = bestPairs.get(key);
      bestPairs.set(key, { ...pair,
        userIds: [...new Set([...(previous?.userIds ?? []), ...pair.userIds])].sort((left, right) => left - right) });
    };
    const belowCeiling = (participant: number, report: number) => !ceiling
      || participant < ceiling.participant || (participant === ceiling.participant && report < ceiling.report);
    const explore = (index: number, sameAddress: number, participant: number, report: number,
      pathPairs: CandidatePair[]) => {
      if (!canStillSatisfyFirstRotation(targets.length - index)) return;
      const sameAddressUpper = sameAddressUpperBound(index, sameAddress);
      const participantUpper = participant + remainingMatchUpperBound(index, "participant");
      const reportUpper = report + remainingMatchUpperBound(index, "report");
      if (requiredSameAddress != null && (sameAddress > requiredSameAddress || sameAddressUpper < requiredSameAddress)) return;
      if (requiredSameAddress == null && sameAddressUpper < bestSameAddress) return;
      if (sameAddressUpper === bestSameAddress && participantUpper < bestParticipant) return;
      if (sameAddressUpper === bestSameAddress && participantUpper === bestParticipant
        && reportUpper < bestReport) return;
      if (index >= targets.length) {
        if (!firstRotationValid() || !belowCeiling(participant, report)
          || (requiredSameAddress != null && sameAddress !== requiredSameAddress)
          || (exactRole && (participant !== exactRole.participant || report !== exactRole.report))) return;
        if (sameAddress > bestSameAddress || (sameAddress === bestSameAddress
          && (participant > bestParticipant || (participant === bestParticipant && report > bestReport)))) {
          bestSameAddress = sameAddress;
          bestParticipant = participant;
          bestReport = report;
          bestPairs.clear();
        }
        if ((exhaustive || !bestPairs.size) && sameAddress === bestSameAddress
          && participant === bestParticipant && report === bestReport) {
          pathPairs.forEach(mergeBestPair);
        }
        return;
      }
      if (!exhaustive && bestPairs.size && sameAddressUpper === bestSameAddress
        && participantUpper === bestParticipant && reportUpper === bestReport) return;
      const target = targets[index];
      const candidates = [...users].sort((left, right) =>
        Number(target.measurementParticipantUserIds?.includes(right.id) ?? false)
          - Number(target.measurementParticipantUserIds?.includes(left.id) ?? false)
        || Number(target.reportWriterUserId === right.id) - Number(target.reportWriterUserId === left.id)
        || left.id - right.id);
      for (const user of candidates) {
        const prior = occupancy.get(user.id) ?? [];
        if (prior.length >= 2) continue;
        const exact = prior.some((item) => normalizedAddress(item.address)
          && normalizedAddress(item.address) === normalizedAddress(target.address));
        if (prior.length === 1 && !exact) {
          const ids = [target.targetId, prior[0].targetId].sort((left, right) => left - right);
          const known = evidence.find((item) => item.date === date && item.leftTargetId === ids[0]
            && item.rightTargetId === ids[1] && item.routeReason === "MEASUREMENT_ASSIGNEE_SECOND_ASSIGNMENT");
          if (known && !(known.provider === "vehicle" && known.durationMinutes != null
            && known.durationMinutes <= 60)) continue;
        }
        const nextPairs = prior.length === 1
          ? [...pathPairs, { date, left: target, right: prior[0], userIds: [user.id] }]
          : pathPairs;
        occupancy.set(user.id, [...prior, { ...target, userId: user.id }]);
        explore(index + 1, sameAddress + Number(exact),
          participant + Number(target.measurementParticipantUserIds?.includes(user.id) ?? false),
          report + Number(target.reportWriterUserId === user.id), nextPairs);
        occupancy.set(user.id, prior);
      }
    };
    explore(0, 0, 0, 0, []);
    return bestParticipant < 0 ? null : {
      sameAddress: bestSameAddress,
      participant: bestParticipant,
      report: bestReport,
      pairs: [...bestPairs.values()],
      exhaustive,
    } satisfies CandidateTier;
  };
  const maxPairs = positiveInteger(options.maxPairs
    ?? process.env.REVERSE_PLANNER_ROUTE_MAX_PAIRS, DEFAULT_MAX_PAIRS);
  const evidence = [...snapshot.routeEvidence];
  const locationByCode = new Map<string, Coordinate>();
  const routes = options.routes ?? createRouteMetrics();
  const deadlineMs = positiveInteger(options.deadlineMs
    ?? process.env.REVERSE_PLANNER_ROUTE_DEADLINE_MS, DEFAULT_DEADLINE_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const evidenceKeys = new Set(evidence.filter((item) => item.routeReason === "MEASUREMENT_ASSIGNEE_SECOND_ASSIGNMENT")
    .map((item) => `${item.date}|${Math.min(item.leftTargetId, item.rightTargetId)}|${Math.max(item.leftTargetId, item.rightTargetId)}`));
  const requiredPairKeys = new Set<string>();
  const loadedCodes = new Set<string>();
  let budgetExceeded = false;
  const queryTier = async (pairs: CandidatePair[]) => {
    const external: CandidatePair[] = [];
    for (const pair of pairs.sort((left, right) => pairKey(left).localeCompare(pairKey(right)))) {
      const key = pairKey(pair);
      if (evidenceKeys.has(key)) continue;
      const sameAddress = normalizedAddress(pair.left.address)
        && normalizedAddress(pair.left.address) === normalizedAddress(pair.right.address);
      if (sameAddress) {
        evidence.push(routeEvidenceFor(pair, 0, "same_address", 0, 0));
        evidenceKeys.add(key);
      } else {
        requiredPairKeys.add(key);
        external.push(pair);
      }
    }
    if (!external.length) return;
    if (requiredPairKeys.size > maxPairs) {
      budgetExceeded = true;
      external.forEach((pair) => {
        evidence.push(routeEvidenceFor(pair, null, "route_guard", null, null));
        evidenceKeys.add(pairKey(pair));
      });
      return;
    }
    if (options.loadCoordinates) {
      const codes = [...new Set(external.flatMap((pair) => [pair.left.businessCode, pair.right.businessCode])
        .filter((code): code is string => typeof code === "string" && code.length > 0 && !loadedCodes.has(code)))];
      codes.forEach((code) => loadedCodes.add(code));
      if (codes.length) {
        try {
          const loaded = await options.loadCoordinates(codes);
          loaded.forEach((coordinate, code) => locationByCode.set(code, coordinate));
        } catch {
          console.warn("[reverse-planner] measurement coordinate lookup failed");
        }
      }
    }
    let index = 0;
    const workers = Array.from({ length: Math.min(positiveInteger(options.concurrency
      ?? process.env.REVERSE_PLANNER_ROUTE_CONCURRENCY, DEFAULT_CONCURRENCY), external.length) }, async () => {
      while (index < external.length) {
        const pair = external[index++];
        const key = pairKey(pair);
        if (controller.signal.aborted) {
          evidence.push(routeEvidenceFor(pair, null, "route_deadline", null, null));
          evidenceKeys.add(key);
          continue;
        }
        const left = { coordinate: pair.left.coordinate ?? locationByCode.get(pair.left.businessCode ?? "") ?? null, region: null } as any;
        const right = { coordinate: pair.right.coordinate ?? locationByCode.get(pair.right.businessCode ?? "") ?? null, region: null } as any;
        try {
          const settled = await settleBeforeDeadline(routes.between(left, right, { signal: controller.signal }), controller.signal);
          if (settled.timedOut) {
            evidence.push(routeEvidenceFor(pair, null, "route_deadline", null, null));
          } else {
            const forwardMinutes = settled.value.source === "vehicle" ? settled.value.durationMinutes : null;
            evidence.push(routeEvidenceFor(pair, forwardMinutes, forwardMinutes != null ? "vehicle" : "route_unavailable",
              forwardMinutes, null));
          }
        } catch {
          evidence.push(routeEvidenceFor(pair, null, "route_unavailable", null, null));
        }
        evidenceKeys.add(key);
      }
    });
    await Promise.all(workers);
  };
  try {
    for (const date of [...new Set(input.missing.map((item) => item.measurementDate))]) {
      const oversizedTargets = input.missing.filter((item) => item.measurementDate === date)
        .sort((left, right) => left.targetId - right.targetId);
      if (oversizedTargets.length > 9) {
        for (const [index, left] of oversizedTargets.entries()) {
          for (const right of oversizedTargets.slice(index + 1)) {
            if (normalizedAddress(left.address) && normalizedAddress(left.address) === normalizedAddress(right.address)) continue;
            requiredPairKeys.add(`${date}|${Math.min(left.targetId, right.targetId)}|${Math.max(left.targetId, right.targetId)}`);
          }
        }
        if (requiredPairKeys.size > maxPairs) {
          budgetExceeded = true;
          break;
        }
      }
      let ceiling: CandidateTier | null = null;
      let requiredSameAddress: number | null = null;
      while (!controller.signal.aborted && !budgetExceeded) {
        let tier = findNextTier(date, ceiling, requiredSameAddress);
        if (!tier) break;
        requiredSameAddress ??= tier.sameAddress;
        while (tier && !controller.signal.aborted && !budgetExceeded) {
          await queryTier(tier.pairs);
          const calculation = calculateAutomatic(snapshot, evidence);
          const resolved = calculation.automatic.filter((item) => item.measurementDate === date);
          const dateTargets = input.missing.filter((item) => item.measurementDate === date)
            .sort((left, right) => left.targetId - right.targetId);
          if (resolved.length === dateTargets.length) {
            const byTarget = new Map(resolved.map((item) => [item.targetId, item.userId]));
            const current = assigned.filter((item) => item.measurementDate === date);
            let sameAddress = 0; let participant = 0; let report = 0;
            for (const target of dateTargets) {
              const userId = byTarget.get(target.targetId);
              if (userId == null) continue;
              sameAddress += Number(current.some((item) => item.userId === userId && normalizedAddress(item.address)
                && normalizedAddress(item.address) === normalizedAddress(target.address)));
              participant += Number(target.measurementParticipantUserIds?.includes(userId) ?? false);
              report += Number(target.reportWriterUserId === userId);
              current.push({ ...target, userId });
            }
            if (sameAddress === tier.sameAddress && participant === tier.participant && report === tier.report) break;
          }
          const alternative: CandidateTier | null = tier.exhaustive
            ? null : findNextTier(date, null, requiredSameAddress, tier);
          if (!alternative) break;
          tier = alternative;
        }
        const calculation = calculateAutomatic(snapshot, evidence);
        const resolved = calculation.automatic.filter((item) => item.measurementDate === date);
        const dateTargetCount = input.missing.filter((item) => item.measurementDate === date).length;
        if (resolved.length === dateTargetCount) break;
        ceiling = tier;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const sortedEvidence = evidence.sort((left, right) => left.date.localeCompare(right.date)
    || left.leftTargetId - right.leftTargetId || left.rightTargetId - right.rightTargetId);
  const resolvedSnapshot = withAutomaticMeasurementAssignments(snapshot, sortedEvidence);
  if (budgetExceeded) {
    const unresolvedKeys = new Set(input.missing.map((target) => keyOf(target.targetId, target.measurementDate)));
    resolvedSnapshot.targets = resolvedSnapshot.targets.map((target) => ({
      ...target,
      automaticAssignmentIssue: target.days.some((day) => unresolvedKeys.has(keyOf(target.id, day.date)))
        ? "MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED"
        : target.automaticAssignmentIssue,
      fixedAssignments: target.fixedAssignments.filter((fixed) => fixed.origin !== "automatic"),
    }));
  }
  return {
    snapshot: resolvedSnapshot,
    routeEvidence: sortedEvidence,
    requiredPairs: requiredPairKeys.size,
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
