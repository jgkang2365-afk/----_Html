import type { ExistingAssignment } from "./types";

export interface ExistingPhoneDateCandidate {
  date: string;
  responsibleUserId: number;
  workingDaysBefore: number;
  primary: boolean;
}

export interface ExistingPhoneDateTarget {
  targetId: number;
  candidates: ExistingPhoneDateCandidate[];
}

export interface ExistingPhoneDateSelection {
  date: string;
  responsibleUserId: number;
}

interface Edge {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
  targetId?: number;
  date?: string;
}

const FALLBACK_PENALTY = 1_000_000_000;
const DATE_LOAD_WEIGHT = 10_000;
const RESPONSIBLE_LOAD_WEIGHT = 100;

function assignmentMethod(assignment: ExistingAssignment) {
  return assignment.surveyMethod ?? (assignment.kind === "existing" ? "phone" : "field");
}

/**
 * 기존업체 유선 날짜를 업체별 greedy가 아닌 batch 전체 min-cost flow로 배정한다.
 * 비용 우선순위는 primary 구간 유지 → 날짜 load 제곱합 최소화 → canonical 날짜순이다.
 */
export function allocateExistingPhoneDates(
  targets: ExistingPhoneDateTarget[],
  existingAssignments: ExistingAssignment[],
) {
  if (!targets.length) return new Map<number, ExistingPhoneDateSelection>();

  const baseDateLoad = new Map<string, number>();
  const baseResponsibleLoad = new Map<string, number>();
  for (const assignment of existingAssignments) {
    if (assignment.kind !== "existing" || assignmentMethod(assignment) !== "phone") continue;
    baseDateLoad.set(assignment.date, (baseDateLoad.get(assignment.date) ?? 0) + 1);
    const key = `${assignment.responsibleUserId}|${assignment.date}`;
    baseResponsibleLoad.set(key, (baseResponsibleLoad.get(key) ?? 0) + 1);
  }

  const dates = [...new Set(targets.flatMap((target) => target.candidates.map((candidate) => candidate.date)))].sort();
  const resourceKeys = [...new Set(targets.flatMap((target) => target.candidates.map((candidate) =>
    `${candidate.responsibleUserId}|${candidate.date}`)))].sort();
  const source = 0;
  const targetOffset = 1;
  const resourceOffset = targetOffset + targets.length;
  const dateOffset = resourceOffset + resourceKeys.length;
  const sink = dateOffset + dates.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number, cost: number, metadata: Partial<Edge> = {}) => {
    const forward: Edge = { to, reverse: graph[to].length, capacity, cost, ...metadata };
    const backward: Edge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
    graph[from].push(forward);
    graph[to].push(backward);
  };
  const resourceIndex = new Map(resourceKeys.map((key, index) => [key, resourceOffset + index]));
  const dateIndex = new Map(dates.map((date, index) => [date, dateOffset + index]));

  targets.forEach((target, index) => {
    const targetNode = targetOffset + index;
    addEdge(source, targetNode, 1, 0);
    target.candidates.forEach((candidate, candidateIndex) => {
      const resourceNode = resourceIndex.get(`${candidate.responsibleUserId}|${candidate.date}`)!;
      addEdge(targetNode, resourceNode, 1,
        (candidate.primary ? 0 : FALLBACK_PENALTY) + candidateIndex,
        { targetId: target.targetId, date: candidate.date });
    });
  });

  resourceKeys.forEach((key) => {
    const [responsibleUserId, date] = key.split("|");
    const base = baseResponsibleLoad.get(`${responsibleUserId}|${date}`) ?? 0;
    const remaining = Math.max(0, 3 - base);
    for (let slot = 0; slot < remaining; slot += 1) {
      addEdge(resourceIndex.get(key)!, dateIndex.get(date)!, 1,
        (2 * (base + slot) + 1) * RESPONSIBLE_LOAD_WEIGHT);
    }
  });
  dates.forEach((date) => {
    const base = baseDateLoad.get(date) ?? 0;
    for (let slot = 0; slot < targets.length; slot += 1) {
      const marginalSquareCost = (2 * (base + slot) + 1) * DATE_LOAD_WEIGHT;
      addEdge(dateIndex.get(date)!, sink, 1, marginalSquareCost);
    }
  });

  let flow = 0;
  while (flow < targets.length) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array(graph.length).fill(-1);
    const previousEdge = Array(graph.length).fill(-1);
    const inQueue = Array(graph.length).fill(false);
    const queue = [source];
    distance[source] = 0;
    inQueue[source] = true;
    while (queue.length) {
      const node = queue.shift()!;
      inQueue[node] = false;
      graph[node].forEach((edge, edgeIndex) => {
        if (edge.capacity <= 0 || distance[edge.to] <= distance[node] + edge.cost) return;
        distance[edge.to] = distance[node] + edge.cost;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        if (!inQueue[edge.to]) {
          queue.push(edge.to);
          inQueue[edge.to] = true;
        }
      });
    }
    if (!Number.isFinite(distance[sink])) return null;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverse].capacity += 1;
    }
    flow += 1;
  }

  const selected = new Map<number, ExistingPhoneDateSelection>();
  targets.forEach((target, index) => {
    const targetNode = targetOffset + index;
    const edge = graph[targetNode].find((candidate) => candidate.targetId === target.targetId && candidate.capacity === 0);
    if (edge?.date) {
      const candidate = target.candidates.find((item) => item.date === edge.date &&
        resourceIndex.get(`${item.responsibleUserId}|${item.date}`) === edge.to);
      if (candidate) selected.set(target.targetId, { date: edge.date, responsibleUserId: candidate.responsibleUserId });
    }
  });
  return selected.size === targets.length ? selected : null;
}
