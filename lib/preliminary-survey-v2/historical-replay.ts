import { createHash } from "node:crypto";

export const STAGE2_PROTECTED_CODES = new Set([
  "H0399", "H0524", "H0288", "H0528", "H0348",
  "H0126", "H0281", "H0260", "H0063", "H0077",
]);

export function normalizeReplayPeriod(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

export function replayJournalKey(code: unknown, year: unknown, period: unknown) {
  return `${String(code ?? "").trim()}|${Number(year)}|${normalizeReplayPeriod(period)}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function stableReplayJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

export function replaySourceFingerprint(value: unknown) {
  return createHash("sha256").update(stableReplayJson(value)).digest("hex");
}

export interface ReplayComparableResult {
  targetId: number;
  replayDate: string | null;
  responsibleUserId: number | null;
  reviewerUserId: number | null;
  participantUserIds: number[];
  measurementAssignments: Array<{
    measurementDate: string;
    assigneeUserId: number;
    surveyCode: string;
    approvalRequired: boolean;
  }>;
  warning: string[];
  status: string;
}

export function canonicalReplayResults(results: ReplayComparableResult[]) {
  return [...results].sort((left, right) => left.targetId - right.targetId).map((result) => ({
    ...result,
    participantUserIds: [...result.participantUserIds].sort((left, right) => left - right),
    measurementAssignments: [...result.measurementAssignments].sort((left, right) =>
      left.measurementDate.localeCompare(right.measurementDate) || left.assigneeUserId - right.assigneeUserId,
    ),
    warning: [...result.warning].sort(),
  }));
}

export function sameReplayResults(left: ReplayComparableResult[], right: ReplayComparableResult[]) {
  return stableReplayJson(canonicalReplayResults(left)) === stableReplayJson(canonicalReplayResults(right));
}

export function replayChangeType(input: {
  excluded?: "true_confirmed" | "protected" | "source_incomplete" | "hard_blocked";
  manualPreserved?: boolean;
  currentDate: string | null;
  replayDate: string | null;
  currentResponsibleUserId: number | null;
  replayResponsibleUserId: number | null;
  measurementAssigneeChanged: boolean;
}) {
  if (input.excluded === "true_confirmed") return "true_confirmed_excluded";
  if (input.excluded === "protected") return "protected_excluded";
  if (input.excluded === "source_incomplete") return "source_incomplete";
  if (input.excluded === "hard_blocked") return "hard_blocked";
  if (input.manualPreserved && input.currentDate === input.replayDate &&
      input.currentResponsibleUserId === input.replayResponsibleUserId && !input.measurementAssigneeChanged) {
    return "manual_preserved";
  }
  const dateChanged = input.currentDate !== input.replayDate;
  const surveyorChanged = input.currentResponsibleUserId !== input.replayResponsibleUserId;
  if (dateChanged && surveyorChanged) return "date_and_surveyor_changed";
  if (dateChanged) return "date_changed";
  if (surveyorChanged) return "surveyor_changed";
  if (input.measurementAssigneeChanged) return "measurement_assignee_changed";
  return "unchanged";
}
