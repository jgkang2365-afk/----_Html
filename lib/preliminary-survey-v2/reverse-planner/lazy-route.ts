import { createRouteMetrics } from "../route-metrics";
import type { Coordinate, RouteMetrics } from "../types";
import { planPreliminarySurveyGivenFixedAssignments } from "./solver";
import { collectRequiredRoutePairs, normalizeRouteAddress, routeRequirementKey } from "./route-requirements";
import type {
  PlannerRouteEvidence,
  PlannerRouteStats,
  PlanningSnapshot,
  RouteRequirement,
} from "./types";

const DEFAULT_MAX_ROUTE_PAIRS = 20;
const DEFAULT_ROUTE_CONCURRENCY = 4;
const DEFAULT_ROUTE_DEADLINE_MS = 20_000;

type RouteLocation = {
  businessCode: string;
  address: string | null;
  coordinate: Coordinate | null;
};

export type LazyRouteOptions = {
  routes?: RouteMetrics;
  loadCoordinates?: (businessCodes: string[]) => Promise<Map<string, Coordinate>>;
  maxPairs?: number;
  concurrency?: number;
  deadlineMs?: number;
};

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function routePairLimit(options: LazyRouteOptions) {
  return positiveInteger(options.maxPairs
    ?? process.env.REVERSE_PLANNER_ROUTE_MAX_PAIRS, DEFAULT_MAX_ROUTE_PAIRS);
}

function routeConcurrency(options: LazyRouteOptions) {
  return positiveInteger(options.concurrency
    ?? process.env.REVERSE_PLANNER_ROUTE_CONCURRENCY, DEFAULT_ROUTE_CONCURRENCY);
}

function routeDeadlineMs(options: LazyRouteOptions) {
  return positiveInteger(options.deadlineMs
    ?? process.env.REVERSE_PLANNER_ROUTE_DEADLINE_MS, DEFAULT_ROUTE_DEADLINE_MS);
}

function locationIndex(snapshot: PlanningSnapshot) {
  const result = new Map<number, RouteLocation>();
  for (const target of snapshot.targets) {
    result.set(target.id, {
      businessCode: target.code,
      address: target.address,
      coordinate: target.coordinate ?? null,
    });
  }
  for (const item of [...snapshot.actualMeasurementOccupancy, ...snapshot.existingSurveyOccupancy]) {
    if (!result.has(item.targetId)) {
      result.set(item.targetId, {
        businessCode: item.businessCode,
        address: item.address,
        coordinate: item.coordinate ?? null,
      });
    }
  }
  return result;
}

function evidenceFor(
  requirement: RouteRequirement,
  capturedAt: string,
  values: Pick<PlannerRouteEvidence,
    "sameAddress" | "durationMinutes" | "provider" | "forwardDurationMinutes"
    | "reverseDurationMinutes" | "effectiveDurationMinutes" | "forwardProvider" | "reverseProvider">,
): PlannerRouteEvidence {
  return {
    date: requirement.date,
    leftTargetId: requirement.leftTargetId,
    rightTargetId: requirement.rightTargetId,
    capturedAt,
    routeReason: requirement.reasons[0],
    sharedUserIds: requirement.sharedUserIds,
    ...values,
  };
}

function unresolvedEvidence(requirement: RouteRequirement, capturedAt: string, provider: "route_guard" | "route_deadline") {
  return evidenceFor(requirement, capturedAt, {
    sameAddress: false,
    durationMinutes: null,
    provider,
    forwardDurationMinutes: null,
    reverseDurationMinutes: null,
    effectiveDurationMinutes: null,
    forwardProvider: provider,
    reverseProvider: provider,
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

async function settleBeforeDeadline<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  if (signal.aborted) return { timedOut: true };
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve({ timedOut: true });
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => resolve({ timedOut: false, value }),
      reject,
    ).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Preview 전용: route-free solve 뒤 실제 shared-person pair만 양방향 조회해 evidence를 동결한다. */
export async function resolveLazyRouteEvidence(snapshot: PlanningSnapshot, options: LazyRouteOptions = {}) {
  const routes = options.routes ?? createRouteMetrics();
  const locations = locationIndex(snapshot);
  const evidence = new Map(snapshot.routeEvidence.map((item) => [routeRequirementKey(item), item]));
  const requiredKeys = new Set<string>();
  const candidatePairKeys = new Set<string>();
  const budgetedPairKeys = new Set<string>();
  const loadedCoordinateCodes = new Set<string>();
  let sameAddressResolved = 0;
  let guardedPairs = 0;
  let deadlinePairs = 0;
  let solverTimedOut = false;
  const capturedAt = new Date().toISOString();
  const maxPairs = routePairLimit(options);
  const concurrency = routeConcurrency(options);
  const deadlineMs = routeDeadlineMs(options);
  const deadlineAt = Date.now() + deadlineMs;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), deadlineMs);
  let seedActualMeasurementRequirements = true;

  try {
    while (true) {
      if (!seedActualMeasurementRequirements && (deadlineController.signal.aborted || Date.now() >= deadlineAt)) {
        solverTimedOut = true;
        break;
      }
      const provisionalSnapshot = { ...snapshot, routeEvidence: [...evidence.values()] };
      // 실제 측정팀 중복은 solver 결과와 무관하다. 이를 먼저 해결하면 route-free global solve가
      // 이미 확정된 이동 불가 대상을 조합에 넣어 지수적으로 탐색하는 일을 피할 수 있다.
      const collectingSeed = seedActualMeasurementRequirements;
      const provisional = collectingSeed ? null
        : planPreliminarySurveyGivenFixedAssignments(provisionalSnapshot,
          { allowMissingRouteEvidence: true, deadlineAt });
      if (provisional?.solverTimedOut) {
        solverTimedOut = true;
        break;
      }
      const requirements = collectingSeed
        ? collectRequiredRoutePairs(provisionalSnapshot, {
          results: [],
          sourceFingerprint: "",
          canonicalSha: snapshot.canonicalSha,
          plannerVersion: snapshot.plannerVersion,
        })
        : collectRequiredRoutePairs(provisionalSnapshot, provisional!);
      seedActualMeasurementRequirements = false;
      requirements.forEach((requirement) => candidatePairKeys.add(routeRequirementKey(requirement)));
      const unresolved = requirements.filter((requirement) => !evidence.has(routeRequirementKey(requirement)));
      if (collectingSeed && !unresolved.length) continue;
      if (!unresolved.length) break;

      unresolved.forEach((requirement) => requiredKeys.add(routeRequirementKey(requirement)));
      let added = 0;
      const external: RouteRequirement[] = [];
      for (const requirement of unresolved) {
        const key = routeRequirementKey(requirement);
        const left = locations.get(requirement.leftTargetId);
        const right = locations.get(requirement.rightTargetId);
        const leftAddress = normalizeRouteAddress(left?.address);
        const rightAddress = normalizeRouteAddress(right?.address);
        if (leftAddress && leftAddress === rightAddress) {
          evidence.set(key, evidenceFor(requirement, capturedAt, {
            sameAddress: true,
            durationMinutes: 0,
            provider: "same_address",
            forwardDurationMinutes: 0,
            reverseDurationMinutes: 0,
            effectiveDurationMinutes: 0,
            forwardProvider: "same_address",
            reverseProvider: "same_address",
          }));
          sameAddressResolved += 1;
          added += 1;
        } else {
          external.push(requirement);
        }
      }

      if (external.length) {
        const deadlineReached = deadlineController.signal.aborted || Date.now() >= deadlineAt;
        const remainingBudget = maxPairs - budgetedPairKeys.size;
        if (deadlineReached) {
          for (const requirement of external) {
            evidence.set(routeRequirementKey(requirement), unresolvedEvidence(requirement, capturedAt, "route_deadline"));
            deadlinePairs += 1;
            added += 1;
          }
          break;
        } else if (external.length > remainingBudget) {
          // 정렬 앞쪽만 처리하는 target-id 편향을 만들지 않고 현재 unresolved 묶음 전체를 보수적으로 낮춘다.
          for (const requirement of external) {
            evidence.set(routeRequirementKey(requirement), unresolvedEvidence(requirement, capturedAt, "route_guard"));
            guardedPairs += 1;
            added += 1;
          }
          break;
        } else {
          external.forEach((requirement) => budgetedPairKeys.add(routeRequirementKey(requirement)));
          if (options.loadCoordinates) {
            const codes = [...new Set(external.flatMap((requirement) => [
              locations.get(requirement.leftTargetId)?.businessCode,
              locations.get(requirement.rightTargetId)?.businessCode,
            ]).filter((code): code is string => Boolean(code))
              .filter((code) => !loadedCoordinateCodes.has(code)))];
            codes.forEach((code) => loadedCoordinateCodes.add(code));
            if (codes.length) {
              try {
                const loadedResult = await settleBeforeDeadline(
                  options.loadCoordinates(codes),
                  deadlineController.signal,
                );
                if (!loadedResult.timedOut) {
                  for (const location of locations.values()) {
                    const coordinate = loadedResult.value.get(location.businessCode);
                    if (coordinate) location.coordinate = coordinate;
                  }
                }
              } catch {
                console.warn("[reverse-planner] coordinate lookup failed");
              }
            }
          }

          await mapWithConcurrency(external, concurrency, async (requirement) => {
            const key = routeRequirementKey(requirement);
            if (deadlineController.signal.aborted || Date.now() >= deadlineAt) {
              evidence.set(key, unresolvedEvidence(requirement, capturedAt, "route_deadline"));
              deadlinePairs += 1;
              added += 1;
              return;
            }
            const left = locations.get(requirement.leftTargetId);
            const right = locations.get(requirement.rightTargetId);
            const region = (address: string | null | undefined) => String(address ?? "").trim()
              .split(/\s+/).slice(0, 2).join(" ") || null;
            const settled = await settleBeforeDeadline(Promise.allSettled([
              routes.between(
                { coordinate: left?.coordinate ?? null, region: region(left?.address) } as any,
                { coordinate: right?.coordinate ?? null, region: region(right?.address) } as any,
                { signal: deadlineController.signal },
              ),
              routes.between(
                { coordinate: right?.coordinate ?? null, region: region(right?.address) } as any,
                { coordinate: left?.coordinate ?? null, region: region(left?.address) } as any,
                { signal: deadlineController.signal },
              ),
            ]), deadlineController.signal);
            if (settled.timedOut) {
              evidence.set(key, unresolvedEvidence(requirement, capturedAt, "route_deadline"));
              deadlinePairs += 1;
              added += 1;
              return;
            }
            const [forwardResult, reverseResult] = settled.value;
            const forward = forwardResult.status === "fulfilled" ? forwardResult.value : null;
            const reverse = reverseResult.status === "fulfilled" ? reverseResult.value : null;
            const forwardMinutes = forward?.source === "vehicle" ? forward.durationMinutes : null;
            const reverseMinutes = reverse?.source === "vehicle" ? reverse.durationMinutes : null;
            const complete = forwardMinutes != null && reverseMinutes != null;
            const deadlineExpired = deadlineController.signal.aborted || Date.now() >= deadlineAt;
            const provider = deadlineExpired && !complete
              ? "route_deadline"
              : complete ? "vehicle_bidirectional" : "incomplete_direction";
            const effective = complete ? Math.max(forwardMinutes, reverseMinutes) : null;
            evidence.set(key, evidenceFor(requirement, capturedAt, {
              sameAddress: false,
              durationMinutes: effective,
              provider,
              forwardDurationMinutes: forwardMinutes,
              reverseDurationMinutes: reverseMinutes,
              effectiveDurationMinutes: effective,
              forwardProvider: forward?.source ?? "error",
              reverseProvider: reverse?.source ?? "error",
            }));
            if (provider === "route_deadline") deadlinePairs += 1;
            added += 1;
          });
        }
      }

      // progress invariant: 새 evidence가 없으면 같은 unresolved 집합을 반복하지 않고 종료한다.
      if (!added) break;
    }
  } finally {
    clearTimeout(deadlineTimer);
  }

  const metricStats = routes.stats;
  const allEvidence = [...evidence.values()].sort((left, right) => left.date.localeCompare(right.date)
    || left.leftTargetId - right.leftTargetId || left.rightTargetId - right.rightTargetId);
  const snapshotTargetCount = new Set([
    ...snapshot.targets.map((target) => target.id),
    ...snapshot.actualMeasurementOccupancy.map((item) => item.targetId),
    ...snapshot.existingSurveyOccupancy.map((item) => item.targetId),
  ]).size;
  const stats: PlannerRouteStats = {
    planningTargetCount: snapshot.targets.length,
    snapshotTargetCount,
    candidatePairs: candidatePairKeys.size,
    requiredPairs: requiredKeys.size,
    sameAddressResolved,
    cacheHits: (metricStats?.sessionCacheHits ?? 0) + (metricStats?.sharedCacheHits ?? 0),
    negativeCacheHits: metricStats?.negativeCacheHits ?? 0,
    directionalRequests: metricStats?.requests ?? 0,
    externalCalls: metricStats?.externalCalls ?? 0,
    routeSuccess: metricStats?.successes ?? 0,
    routeFailure: metricStats?.failures ?? 0,
    routeUnknown: allEvidence.filter((item) => !item.sameAddress && item.durationMinutes == null).length,
    guardedPairs,
    deadlinePairs,
  };
  return { snapshot: { ...snapshot, routeEvidence: allEvidence }, stats, solverTimedOut };
}
