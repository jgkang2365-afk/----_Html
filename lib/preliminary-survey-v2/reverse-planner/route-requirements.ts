import type {
  PlanningSnapshot,
  ReversePlannerOutput,
  RouteRequirement,
  RouteRequirementReason,
} from "./types";

type MobilityItem = { targetId: number; date: string; participantUserIds: number[] };

const pairKey = (date: string, leftTargetId: number, rightTargetId: number) =>
  `${date}|${Math.min(leftTargetId, rightTargetId)}|${Math.max(leftTargetId, rightTargetId)}`;

function addIndexedRequirements(
  result: Map<string, RouteRequirement>,
  items: MobilityItem[],
  planningTargetIds: Set<number>,
  reason: RouteRequirementReason,
) {
  const index = new Map<string, Set<number>>();
  for (const item of items) {
    for (const userId of item.participantUserIds) {
      const key = `${item.date}|${userId}`;
      const targets = index.get(key) ?? new Set<number>();
      targets.add(item.targetId);
      index.set(key, targets);
    }
  }
  for (const [indexKey, targetIds] of index) {
    if (targetIds.size < 2) continue;
    const separator = indexKey.lastIndexOf("|");
    const date = indexKey.slice(0, separator);
    const userId = Number(indexKey.slice(separator + 1));
    const sorted = [...targetIds].sort((left, right) => left - right);
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const leftTargetId = sorted[leftIndex];
        const rightTargetId = sorted[rightIndex];
        if (!planningTargetIds.has(leftTargetId) && !planningTargetIds.has(rightTargetId)) continue;
        const key = pairKey(date, leftTargetId, rightTargetId);
        const current = result.get(key) ?? {
          date, leftTargetId, rightTargetId, reasons: [], sharedUserIds: [],
        };
        if (!current.reasons.includes(reason)) current.reasons.push(reason);
        if (!current.sharedUserIds.includes(userId)) current.sharedUserIds.push(userId);
        current.reasons.sort();
        current.sharedUserIds.sort((left, right) => left - right);
        result.set(key, current);
      }
    }
  }
}

/** Route가 없으면 현재 Preview 판단을 끝낼 수 없는 shared-person pair만 수집한다. */
export function collectRequiredRoutePairs(
  snapshot: PlanningSnapshot,
  provisional: ReversePlannerOutput,
): RouteRequirement[] {
  const result = new Map<string, RouteRequirement>();
  const planningTargetIds = new Set(snapshot.targets.map((target) => target.id));

  addIndexedRequirements(result, snapshot.actualMeasurementOccupancy, planningTargetIds,
    "ACTUAL_MEASUREMENT_TEAM_OVERLAP");

  const selectedFieldVisits: MobilityItem[] = provisional.results.flatMap((item) =>
    item.candidate?.surveyMethod === "field" ? [{
      targetId: item.targetId,
      date: item.candidate.preliminaryDate,
      participantUserIds: item.candidate.participantUserIds,
    }] : []);
  const externalFieldVisits: MobilityItem[] = snapshot.existingSurveyOccupancy
    .filter((item) => !planningTargetIds.has(item.targetId) && item.surveyMethod === "field")
    .map((item) => ({ targetId: item.targetId, date: item.preliminaryDate,
      participantUserIds: item.participantUserIds }));
  addIndexedRequirements(result, [...selectedFieldVisits, ...externalFieldVisits], planningTargetIds,
    "PRELIMINARY_FIELD_VISIT_OVERLAP");
  const externalTargetIds = new Set(externalFieldVisits.map((item) => item.targetId));
  for (const requirement of result.values()) {
    if (externalTargetIds.has(requirement.leftTargetId) || externalTargetIds.has(requirement.rightTargetId)) {
      requirement.reasons = requirement.reasons
        .filter((item) => item !== "PRELIMINARY_FIELD_VISIT_OVERLAP");
      if (!requirement.reasons.includes("EXISTING_FIELD_OCCUPANCY_OVERLAP")) {
        requirement.reasons.push("EXISTING_FIELD_OCCUPANCY_OVERLAP");
      }
      requirement.reasons.sort();
    }
  }

  return [...result.values()].sort((left, right) => left.date.localeCompare(right.date)
    || left.leftTargetId - right.leftTargetId || left.rightTargetId - right.rightTargetId);
}

export function normalizeRouteAddress(value: string | null | undefined) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim().toLowerCase();
}

export function routeRequirementKey(requirement: Pick<RouteRequirement, "date" | "leftTargetId" | "rightTargetId">) {
  return pairKey(requirement.date, requirement.leftTargetId, requirement.rightTargetId);
}
