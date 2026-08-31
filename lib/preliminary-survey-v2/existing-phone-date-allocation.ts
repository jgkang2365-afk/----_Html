import type { ExistingAssignment } from "./types";

export interface ExistingPhoneDateCandidate {
  date: string;
  responsibleUserId: number;
  workingDaysBefore: number;
  primary: boolean;
  /** 보고서 담당자와 canonical 경력 조합이 가능한 responsible면 true. */
  reportWriterPreferred?: boolean;
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
  responsibleUserId?: number;
}

const FALLBACK_PENALTY = 1_000_000_000;
const DATE_LOAD_WEIGHT = 10_000;
const REPORT_WRITER_PREFERENCE_WEIGHT = 1_000;
const RESPONSIBLE_LOAD_WEIGHT = 100;

function assignmentMethod(assignment: ExistingAssignment) {
  return assignment.surveyMethod ?? (assignment.kind === "existing" ? "phone" : "field");
}

function assignResponsiblesForSelectedDates(
  targets: ExistingPhoneDateTarget[],
  selectedDates: Map<number, ExistingPhoneDateSelection>,
  existingAssignments: ExistingAssignment[],
) {
  const selectedTargets = targets.filter((target) => selectedDates.has(target.targetId));
  if (!selectedTargets.length) return selectedDates;
  const userIds = [...new Set(selectedTargets.flatMap((target) => target.candidates.map((candidate) => candidate.responsibleUserId)))].sort((a, b) => a - b);
  const resourceKeys = [...new Set(selectedTargets.flatMap((target) => {
    const date = selectedDates.get(target.targetId)?.date;
    return date ? target.candidates.filter((candidate) => candidate.date === date)
      .map((candidate) => `${candidate.responsibleUserId}|${date}`) : [];
  }))].sort();
  const baseDaily = new Map<string, number>();
  const baseTotal = new Map<number, number>();
  for (const assignment of existingAssignments) {
    // responsible 전체 수행량은 방문·유선을 합산하되 reviewer는 responsibleUserId가
    // 아니므로 자연스럽게 제외된다. 일일 3건 hard cap은 기존업체 유선에만 적용한다.
    baseTotal.set(assignment.responsibleUserId, (baseTotal.get(assignment.responsibleUserId) ?? 0) + 1);
    if (assignment.kind === "existing" && assignmentMethod(assignment) === "phone") {
      const key = `${assignment.responsibleUserId}|${assignment.date}`;
      baseDaily.set(key, (baseDaily.get(key) ?? 0) + 1);
    }
  }

  const source = 0;
  const targetOffset = 1;
  const resourceOffset = targetOffset + selectedTargets.length;
  const userOffset = resourceOffset + resourceKeys.length;
  const sink = userOffset + userIds.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number, cost: number, metadata: Partial<Edge> = {}) => {
    const forward: Edge = { to, reverse: graph[to].length, capacity, cost, ...metadata };
    const backward: Edge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
    graph[from].push(forward);
    graph[to].push(backward);
  };
  const resourceIndex = new Map(resourceKeys.map((key, index) => [key, resourceOffset + index]));
  const userIndex = new Map(userIds.map((userId, index) => [userId, userOffset + index]));
  const stableRank = new Map(userIds.map((userId, index) => [userId, index]));

  selectedTargets.forEach((target, index) => {
    const targetNode = targetOffset + index;
    addEdge(source, targetNode, 1, 0);
    const date = selectedDates.get(target.targetId)?.date;
    if (!date) return;
    target.candidates.filter((candidate) => candidate.date === date).forEach((candidate) => {
      const preferencePenalty = candidate.reportWriterPreferred ? 0 : REPORT_WRITER_PREFERENCE_WEIGHT;
      addEdge(targetNode, resourceIndex.get(`${candidate.responsibleUserId}|${date}`)!, 1,
        preferencePenalty + (stableRank.get(candidate.responsibleUserId) ?? 0),
        { targetId: target.targetId, date, responsibleUserId: candidate.responsibleUserId });
    });
  });
  resourceKeys.forEach((key) => {
    const [userIdText] = key.split("|");
    const userId = Number(userIdText);
    addEdge(resourceIndex.get(key)!, userIndex.get(userId)!, Math.max(0, 3 - (baseDaily.get(key) ?? 0)), 0);
  });
  userIds.forEach((userId) => {
    const base = baseTotal.get(userId) ?? 0;
    for (let slot = 0; slot < selectedTargets.length; slot += 1) {
      addEdge(userIndex.get(userId)!, sink, 1, (2 * (base + slot) + 1) * RESPONSIBLE_LOAD_WEIGHT);
    }
  });

  let flow = 0;
  while (flow < selectedTargets.length) {
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
    if (!Number.isFinite(distance[sink])) break;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverse].capacity += 1;
    }
    flow += 1;
  }
  if (flow !== selectedTargets.length) return selectedDates;

  const balanced = new Map<number, ExistingPhoneDateSelection>();
  selectedTargets.forEach((target, index) => {
    const edge = graph[targetOffset + index].find((candidate) =>
      candidate.targetId === target.targetId && candidate.capacity === 0);
    if (edge?.date && edge.responsibleUserId != null) {
      balanced.set(target.targetId, { date: edge.date, responsibleUserId: edge.responsibleUserId });
    }
  });
  return balanced.size === selectedTargets.length ? balanced : selectedDates;
}

/**
 * 기존업체 유선 날짜를 업체별 greedy가 아닌 batch 전체 min-cost flow로 배정한다.
 * 비용 우선순위는 primary 구간 유지 → 날짜 load 제곱합 최소화 → 보고서 담당자 조합 preference → responsible load다.
 * 날짜 load가 최우선이고, 같은 날짜 후보 안에서는 보고서 담당자와 조합 가능한 responsible를 먼저 고른다.
 * reviewer를 제외한 responsible 실제 수행량을 균등화하고 responsible/day는 최대 3건 hard capacity다.
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
      const preferencePenalty = candidate.reportWriterPreferred ? 0 : REPORT_WRITER_PREFERENCE_WEIGHT;
      addEdge(targetNode, resourceNode, 1,
        (candidate.primary ? 0 : FALLBACK_PENALTY) + preferencePenalty + candidateIndex,
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
    if (!Number.isFinite(distance[sink])) break;
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
  // 일부 target이 hard capacity 때문에 배정되지 않아도 성공 target의 authoritative
  // 선택은 보존한다. 호출자는 누락 target별 실패 reason을 반드시 산출한다.
  return assignResponsiblesForSelectedDates(targets, selected, existingAssignments);
}
