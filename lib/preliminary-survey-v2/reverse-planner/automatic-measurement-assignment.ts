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
const DEFAULT_MAX_PAIRS = 20;
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
      source: item.sameAddress || item.provider === "vehicle_bidirectional" ? "vehicle" as const : "unknown" as const,
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
  const { input, automatic } = calculateAutomatic(snapshot, routeEvidence);
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
  userId: number;
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

/** Preview 전용: 두 번째 자동 측정자 후보에게 실제 필요한 pair만 양방향 조회한다. */
export async function resolveAutomaticMeasurementAssignments(
  snapshot: PlanningSnapshot,
  options: AutomaticMeasurementAssignmentOptions = {},
) {
  const routeFree = withAutomaticMeasurementAssignments(snapshot, snapshot.routeEvidence);
  const routeFreeCalculation = calculateAutomatic(snapshot, snapshot.routeEvidence);
  const resolvedKeys = new Set(routeFreeCalculation.automatic.map((item) => keyOf(item.targetId, item.measurementDate)));
  const firstAssignments: ExistingMeasurementAssignment[] = routeFreeCalculation.automatic.map((item) => ({
    ...routeFreeCalculation.input.missing.find((target) => keyOf(target.targetId, target.measurementDate)
      === keyOf(item.targetId, item.measurementDate))!,
    userId: item.userId,
  }));
  const assigned = [
    ...routeFreeCalculation.input.existing,
    ...routeFreeCalculation.input.explicit,
    ...firstAssignments,
  ];
  const pairs = new Map<string, CandidatePair>();
  for (const target of routeFreeCalculation.input.missing
    .filter((item) => !resolvedKeys.has(keyOf(item.targetId, item.measurementDate)))) {
    for (const user of snapshot.users.filter((item) => item.active && surveyCodes.has(item.baseCode ?? ""))) {
      if (snapshot.scheduleBlocks.some((block) => block.userId === user.id
        && block.startDate <= target.measurementDate && block.endDate >= target.measurementDate)) continue;
      const occupied = assigned.filter((item) => item.measurementDate === target.measurementDate && item.userId === user.id);
      if (occupied.length !== 1) continue;
      const right = occupied[0];
      const ids = [target.targetId, right.targetId].sort((a, b) => a - b);
      pairs.set(`${target.measurementDate}|${ids[0]}|${ids[1]}|${user.id}`, {
        date: target.measurementDate, left: target, right, userId: user.id,
      });
    }
  }
  const maxPairs = positiveInteger(options.maxPairs
    ?? process.env.REVERSE_PLANNER_ROUTE_MAX_PAIRS, DEFAULT_MAX_PAIRS);
  const evidence = [...snapshot.routeEvidence];
  const candidates = [...pairs.values()].sort((left, right) => left.date.localeCompare(right.date)
    || left.left.targetId - right.left.targetId || left.right.targetId - right.right.targetId
    || left.userId - right.userId);
  if (!candidates.length || candidates.length > maxPairs) {
    return { snapshot: routeFree, routeEvidence: evidence, requiredPairs: candidates.length };
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
      const settled = await settleBeforeDeadline(Promise.allSettled([
        routes.between(left, right, { signal: controller.signal }),
        routes.between(right, left, { signal: controller.signal }),
      ]), controller.signal);
      if (settled.timedOut) {
        evidence.push(routeEvidenceFor(pair, null, "route_deadline", null, null));
        continue;
      }
      const [forward, reverse] = settled.value;
      const forwardMinutes = forward.status === "fulfilled" && forward.value.source === "vehicle"
        ? forward.value.durationMinutes : null;
      const reverseMinutes = reverse.status === "fulfilled" && reverse.value.source === "vehicle"
        ? reverse.value.durationMinutes : null;
      const complete = forwardMinutes != null && reverseMinutes != null;
      const effective = complete ? Math.max(forwardMinutes, reverseMinutes) : null;
      evidence.push(routeEvidenceFor(pair, effective, complete ? "vehicle_bidirectional" : "incomplete_direction",
        forwardMinutes, reverseMinutes));
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
    requiredPairs: candidates.length,
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
    sharedUserIds: [pair.userId],
  };
}
