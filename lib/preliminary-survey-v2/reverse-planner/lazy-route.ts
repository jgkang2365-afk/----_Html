import { createRouteMetrics } from "../route-metrics";
import { planPreliminarySurveyGivenFixedAssignments } from "./solver";
import { collectRequiredRoutePairs, normalizeRouteAddress, routeRequirementKey } from "./route-requirements";
import type { PlannerRouteEvidence, PlannerRouteStats, PlanningSnapshot } from "./types";

const DEFAULT_MAX_ROUTE_PAIRS = 50;

function routePairLimit() {
  const configured = Number(process.env.REVERSE_PLANNER_ROUTE_MAX_PAIRS ?? DEFAULT_MAX_ROUTE_PAIRS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_ROUTE_PAIRS;
}

function locationIndex(snapshot: PlanningSnapshot) {
  const result = new Map<number, { address: string | null; coordinate: { latitude: number; longitude: number } | null }>();
  for (const target of snapshot.targets) result.set(target.id, { address: target.address, coordinate: target.coordinate ?? null });
  for (const item of [...snapshot.actualMeasurementOccupancy, ...snapshot.existingSurveyOccupancy]) {
    if (!result.has(item.targetId)) result.set(item.targetId, { address: item.address, coordinate: item.coordinate ?? null });
  }
  return result;
}

/** Preview 전용: route-free solve 뒤 실제 shared-person pair만 조회해 evidence를 동결한다. */
export async function resolveLazyRouteEvidence(snapshot: PlanningSnapshot) {
  const routes = createRouteMetrics();
  const locations = locationIndex(snapshot);
  const evidence = new Map(snapshot.routeEvidence.map((item) => [routeRequirementKey(item), item]));
  const requiredKeys = new Set<string>();
  const candidatePairKeys = new Set<string>();
  let sameAddressResolved = 0;
  const capturedAt = new Date().toISOString();
  const maxPairs = routePairLimit();

  for (let iteration = 0; iteration < Math.max(2, snapshot.targets.length + 1); iteration += 1) {
    const provisionalSnapshot = { ...snapshot, routeEvidence: [...evidence.values()] };
    const provisional = planPreliminarySurveyGivenFixedAssignments(provisionalSnapshot,
      { allowMissingRouteEvidence: true });
    const requirements = collectRequiredRoutePairs(provisionalSnapshot, provisional);
    requirements.forEach((requirement) => candidatePairKeys.add(routeRequirementKey(requirement)));
    const unresolved = requirements.filter((requirement) => !evidence.has(routeRequirementKey(requirement)));
    if (!unresolved.length) break;
    let added = 0;
    for (const requirement of unresolved) {
      const key = routeRequirementKey(requirement);
      requiredKeys.add(key);
      const left = locations.get(requirement.leftTargetId);
      const right = locations.get(requirement.rightTargetId);
      const leftAddress = normalizeRouteAddress(left?.address);
      const rightAddress = normalizeRouteAddress(right?.address);
      const sameAddress = Boolean(leftAddress && leftAddress === rightAddress);
      let route: PlannerRouteEvidence;
      if (sameAddress) {
        sameAddressResolved += 1;
        route = { date: requirement.date, leftTargetId: requirement.leftTargetId, rightTargetId: requirement.rightTargetId,
          sameAddress: true, durationMinutes: 0, provider: "same_address", capturedAt,
          routeReason: requirement.reasons[0], sharedUserIds: requirement.sharedUserIds };
      } else if (requiredKeys.size > maxPairs) {
        route = { date: requirement.date, leftTargetId: requirement.leftTargetId, rightTargetId: requirement.rightTargetId,
          sameAddress: false, durationMinutes: null, provider: "guard", capturedAt,
          routeReason: requirement.reasons[0], sharedUserIds: requirement.sharedUserIds };
      } else {
        const region = (address: string | null | undefined) => String(address ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || null;
        const metric = await routes.between(
          { coordinate: left?.coordinate ?? null, region: region(left?.address) } as any,
          { coordinate: right?.coordinate ?? null, region: region(right?.address) } as any,
        );
        route = { date: requirement.date, leftTargetId: requirement.leftTargetId, rightTargetId: requirement.rightTargetId,
          sameAddress: false,
          durationMinutes: metric.source === "vehicle" ? metric.durationMinutes : null,
          provider: metric.source, capturedAt, routeReason: requirement.reasons[0],
          sharedUserIds: requirement.sharedUserIds };
      }
      evidence.set(key, route);
      added += 1;
    }
    if (!added) break;
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
    externalCalls: metricStats?.externalCalls ?? 0,
    routeSuccess: metricStats?.successes ?? 0,
    routeFailure: metricStats?.failures ?? 0,
    routeUnknown: allEvidence.filter((item) => !item.sameAddress && item.durationMinutes == null).length,
  };
  return { snapshot: { ...snapshot, routeEvidence: allEvidence }, stats };
}
