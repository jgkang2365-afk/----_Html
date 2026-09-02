import { candidateDates, isScheduleBlocked } from "./candidate-dates";
import { sourceFingerprint } from "./fingerprint";
import { normalizePublicSampleCodes } from "./public-sample-code";
import type {
  ExistingPlannerPlan,
  PlannerCandidate,
  PlannerObjective,
  PlannerTarget,
  PlannerUser,
  PlanningSnapshot,
  ReversePlannerOutput,
  ReversePlannerReason,
  ReversePlannerResult,
} from "./types";

const natural = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const preferredReviewerByResponsible: Record<string, string> = {
  "강종구": "이태환",
  "고유빈": "이주형",
  "김민영": "한기문",
};
const ZERO_OBJECTIVE: PlannerObjective = [0, 0, 0, 0, 0, 0];
const sortedTargets = (snapshot: PlanningSnapshot) => [...snapshot.targets]
  .sort((left, right) => natural.compare(left.code, right.code) || left.id - right.id);

function addObjective(left: PlannerObjective, right: PlannerObjective): PlannerObjective {
  return left.map((value, index) => value + right[index]) as unknown as PlannerObjective;
}

function compareObjective(left: PlannerObjective, right: PlannerObjective) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function sourceError(target: PlannerTarget, users: Map<number, PlannerUser>): ReversePlannerReason | null {
  if (!target.days.length || target.days.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day.date))) return "INVALID_MEASUREMENT_DATES";
  if (new Set(target.days.map((day) => day.date)).size !== target.days.length) return "INVALID_DAILY_STAFF";
  if (target.fixedAssignments.length !== target.days.length) return "FIXED_ASSIGNEE_NOT_CONFIRMED";
  for (const day of target.days) {
    if (day.invalidCollaboratorNames?.length || day.invalidReportWriterUserId != null) return "USER_NOT_FOUND";
    if (day.collaboratorUserIds.some((id) => !users.has(id))
        || (day.reportWriterUserId != null && !users.has(day.reportWriterUserId))) return "USER_NOT_FOUND";
    const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date);
    if (!fixed) return "FIXED_ASSIGNEE_NOT_CONFIRMED";
    const user = users.get(fixed.assigneeUserId);
    if (!user) return "USER_NOT_FOUND";
    if (!user.active || !user.baseCode || !/^[A-Z]$/.test(user.baseCode)) return "INVALID_BASE_CODE";
  }
  return null;
}

export function actualTeam(target: PlannerTarget) {
  const team = new Set<number>();
  for (const day of target.days) {
    day.collaboratorUserIds.forEach((id) => team.add(id));
    const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date);
    if (fixed) team.add(fixed.assigneeUserId);
  }
  return team;
}

function routeEvidence(snapshot: PlanningSnapshot, date: string, leftTargetId: number, rightTargetId: number) {
  return snapshot.routeEvidence.find((item) => item.date === date
    && [item.leftTargetId, item.rightTargetId].includes(leftTargetId)
    && [item.leftTargetId, item.rightTargetId].includes(rightTargetId));
}

function rolesValid(snapshot: PlanningSnapshot, candidate: PlannerCandidate) {
  const users = candidate.participantUserIds.map((id) => snapshot.users.find((user) => user.id === id));
  if (users.some((user) => !user?.active)) return false;
  const participants = users.filter((user): user is PlannerUser => Boolean(user));
  const experienced = participants.filter((user) => user.experienced);
  const novices = participants.filter((user) => !user.experienced);
  if (experienced.length === 1 && novices.length === 0) {
    return candidate.responsibleUserId === experienced[0].id
      && candidate.reviewerUserId == null
      && candidate.writerUserId === experienced[0].id;
  }
  if (experienced.length === 1 && novices.length === 1) {
    return candidate.responsibleUserId === novices[0].id
      && candidate.reviewerUserId === experienced[0].id
      && candidate.writerUserId === novices[0].id;
  }
  return false;
}

export function validateCandidateHardRules(
  snapshot: PlanningSnapshot,
  target: PlannerTarget,
  candidate: PlannerCandidate,
): string[] {
  const violations: string[] = [];
  const ranges = candidateDates(target.days[0]?.date ?? "", target.businessType);
  if (![...ranges.primary, ...ranges.fallback].includes(candidate.preliminaryDate)) violations.push("PRELIMINARY_DATE_OUT_OF_RANGE");
  const expectedMethod = target.businessType === "existing" ? "phone" : "field";
  if (candidate.surveyMethod !== expectedMethod) violations.push("SURVEY_METHOD_MISMATCH");
  if (!rolesValid(snapshot, candidate)) violations.push("INVALID_SURVEYOR_ROLE_COMBINATION");
  if (!candidate.participantUserIds.some((id) => actualTeam(target).has(id))) violations.push("ACTUAL_TEAM_INTERSECTION_REQUIRED");
  const scheduledWorkers = candidate.surveyMethod === "phone"
    ? [candidate.responsibleUserId]
    : candidate.participantUserIds;
  if (scheduledWorkers.some((id) => isScheduleBlocked(id, candidate.preliminaryDate, snapshot.scheduleBlocks))) {
    violations.push("USER_UNAVAILABLE_ON_SURVEY_DATE");
  }
  if (candidate.surveyMethod === "field" && snapshot.actualMeasurementOccupancy.some((occupancy) =>
    occupancy.date === candidate.preliminaryDate
    && occupancy.participantUserIds.some((id) => candidate.participantUserIds.includes(id)))) {
    violations.push("ACTUAL_MEASUREMENT_CONFLICT");
  }
  return violations;
}

function candidateObjective(
  snapshot: PlanningSnapshot,
  target: PlannerTarget,
  participants: PlannerUser[],
  responsible: PlannerUser,
  reviewer: PlannerUser | null,
  preliminaryDate: string,
  changedPlanCount: number,
): PlannerObjective {
  const ranges = candidateDates(target.days[0]?.date ?? "", target.businessType);
  const fallback = ranges.fallback.includes(preliminaryDate) ? 1 : 0;
  const reportWriterIds = new Set(target.days.map((day) => day.reportWriterUserId).filter((id): id is number => id != null));
  const reviewerPenalty = reviewer && preferredReviewerByResponsible[responsible.name] !== reviewer.name ? 1 : 0;
  const reportPenalty = participants.some((user) => reportWriterIds.has(user.id)) ? 0 : 1;
  return [fallback, changedPlanCount, 0, reviewerPenalty + reportPenalty, 0, 0];
}

function candidatesFor(snapshot: PlanningSnapshot, target: PlannerTarget): PlannerCandidate[] {
  const active = snapshot.users.filter((user) => user.active);
  const experienced = active.filter((user) => user.experienced);
  const novices = active.filter((user) => !user.experienced);
  const team = actualTeam(target);
  const combinations: Array<{ participants: PlannerUser[]; responsible: PlannerUser; reviewer: PlannerUser | null; writer: PlannerUser }> = [];
  experienced.filter((user) => team.has(user.id)).forEach((user) => {
    combinations.push({ participants: [user], responsible: user, reviewer: null, writer: user });
  });
  for (const novice of novices) {
    for (const reviewer of experienced) {
      if (!team.has(novice.id) && !team.has(reviewer.id)) continue;
      combinations.push({ participants: [reviewer, novice], responsible: novice, reviewer, writer: novice });
    }
  }
  const ranges = candidateDates(target.days[0]?.date ?? "", target.businessType);
  const dates = [...ranges.primary, ...ranges.fallback];
  return combinations.flatMap((choice) => dates.map((date) => {
    const candidate: PlannerCandidate = {
      preliminaryDate: date,
      surveyMethod: target.businessType === "existing" ? "phone" : "field",
      participantUserIds: choice.participants.map((user) => user.id),
      responsibleUserId: choice.responsible.id,
      reviewerUserId: choice.reviewer?.id ?? null,
      writerUserId: choice.writer.id,
      objective: candidateObjective(snapshot, target, choice.participants, choice.responsible, choice.reviewer, date, 1),
      reasons: [ranges.primary.includes(date) ? "PRIMARY_DATE" : "FALLBACK_DATE",
        choice.reviewer ? "EXPERIENCED_AND_INEXPERIENCED" : "EXPERIENCED_SOLO"],
    };
    return candidate;
  })).filter((candidate) => validateCandidateHardRules(snapshot, target, candidate).length === 0)
    .sort((left, right) => compareObjective(left.objective, right.objective)
      || left.preliminaryDate.localeCompare(right.preliminaryDate)
      || left.responsibleUserId - right.responsibleUserId
      || (left.reviewerUserId ?? 0) - (right.reviewerUserId ?? 0));
}

function emptyCandidateReason(snapshot: PlanningSnapshot, target: PlannerTarget): ReversePlannerReason {
  const active = snapshot.users.filter((user) => user.active);
  const experienced = active.filter((user) => user.experienced);
  if (!experienced.length) return "NO_EXPERIENCED_PARTNER_AVAILABLE";
  const team = actualTeam(target);
  const hasCanonicalTeamCombination = experienced.some((user) => team.has(user.id))
    || active.some((user) => !user.experienced && team.has(user.id));
  const ranges = candidateDates(target.days[0]?.date ?? "", target.businessType);
  const mismatchAvailable = experienced.some((user) => !team.has(user.id)
    && [...ranges.primary, ...ranges.fallback].some((date) => !isScheduleBlocked(user.id, date, snapshot.scheduleBlocks)));
  if (hasCanonicalTeamCombination && mismatchAvailable) return "ONLY_MISMATCH_ALTERNATIVES_AVAILABLE";
  return hasCanonicalTeamCombination ? "NO_VALID_PRELIMINARY_DATE" : "ONLY_MISMATCH_ALTERNATIVES_AVAILABLE";
}

function isTransitionProtectedTarget(target: PlannerTarget) {
  return target.days.some((day) => day.date.startsWith("2026-08-"));
}

function existingAssignmentsCompatible(target: PlannerTarget, plan: ExistingPlannerPlan | null) {
  if (!plan?.preliminaryDate || !plan.participantUserIds.some((id) => actualTeam(target).has(id))) return false;
  const fixed = new Map(target.fixedAssignments.map((item) => [item.measurementDate, item.assigneeUserId]));
  return plan.assignments.length === target.days.length
    && plan.assignments.every((item) => fixed.get(item.measurementDate) === item.assigneeUserId);
}

function existingCandidate(snapshot: PlanningSnapshot, target: PlannerTarget): PlannerCandidate | null {
  const plan = target.existingPlan;
  if (!plan?.preliminaryDate || !existingAssignmentsCompatible(target, plan)) return null;
  const userById = new Map(snapshot.users.map((user) => [user.id, user]));
  const participants = plan.participantUserIds.map((id) => userById.get(id)).filter((user): user is PlannerUser => Boolean(user));
  const experienced = participants.filter((user) => user.experienced);
  const novices = participants.filter((user) => !user.experienced);
  const writer = novices[0] ?? experienced[0];
  if (!writer) return null;
  const candidate: PlannerCandidate = {
    preliminaryDate: plan.preliminaryDate,
    surveyMethod: plan.surveyMethod,
    participantUserIds: plan.participantUserIds,
    responsibleUserId: plan.responsibleUserId,
    reviewerUserId: plan.reviewerUserId,
    writerUserId: writer.id,
    objective: candidateObjective(snapshot, target, participants, userById.get(plan.responsibleUserId) ?? writer,
      plan.reviewerUserId == null ? null : userById.get(plan.reviewerUserId) ?? null, plan.preliminaryDate, 0),
    reasons: ["KEEP_EXISTING"],
  };
  return validateCandidateHardRules(snapshot, target, candidate).length === 0 ? candidate : null;
}

function measurementRouteEvidenceMissing(snapshot: PlanningSnapshot, target: PlannerTarget, allowMissingRouteEvidence = false) {
  for (const day of target.days) {
    const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date);
    const team = new Set([...day.collaboratorUserIds, ...(fixed ? [fixed.assigneeUserId] : [])]);
    for (const occupancy of snapshot.actualMeasurementOccupancy) {
      if (occupancy.targetId === target.id || occupancy.date !== day.date
        || !occupancy.participantUserIds.some((id) => team.has(id))) continue;
      const evidence = routeEvidence(snapshot, day.date, target.id, occupancy.targetId);
      if ((!evidence && !allowMissingRouteEvidence)
          || (evidence && !evidence.sameAddress && (evidence.durationMinutes == null || evidence.durationMinutes > 60))) return true;
    }
  }
  return false;
}

function conflictsWithSelected(
  snapshot: PlanningSnapshot,
  target: PlannerTarget,
  candidate: PlannerCandidate,
  selected: Map<number, PlannerCandidate>,
  mutableTargetIds: Set<number>,
  allowMissingRouteEvidence = false,
): { blocked: boolean; phoneReuse: number; longRouteCount: number } {
  const external = snapshot.existingSurveyOccupancy.filter((item) => !mutableTargetIds.has(item.targetId));
  const phoneSameResponsible = external.filter((item) => item.surveyMethod === "phone"
    && item.preliminaryDate === candidate.preliminaryDate && item.responsibleUserId === candidate.responsibleUserId).length
    + [...selected.values()].filter((item) => item.surveyMethod === "phone"
      && item.preliminaryDate === candidate.preliminaryDate && item.responsibleUserId === candidate.responsibleUserId).length;
  if (candidate.surveyMethod === "phone" && phoneSameResponsible >= 3) return { blocked: true, phoneReuse: 0, longRouteCount: 0 };
  const phoneDateUse = candidate.surveyMethod === "phone"
    ? external.filter((item) => item.surveyMethod === "phone" && item.preliminaryDate === candidate.preliminaryDate).length
      + [...selected.values()].filter((item) => item.surveyMethod === "phone" && item.preliminaryDate === candidate.preliminaryDate).length
    : 0;
  if (candidate.surveyMethod !== "field") return { blocked: false, phoneReuse: phoneDateUse, longRouteCount: 0 };

  let longRouteCount = 0;
  const fieldPeers = [
    ...external.filter((item) => item.surveyMethod === "field" && item.preliminaryDate === candidate.preliminaryDate)
      .map((item) => ({ targetId: item.targetId, participantUserIds: item.participantUserIds })),
    ...[...selected.entries()].filter(([, item]) => item.surveyMethod === "field" && item.preliminaryDate === candidate.preliminaryDate)
      .map(([targetId, item]) => ({ targetId, participantUserIds: item.participantUserIds })),
  ];
  for (const participantId of candidate.participantUserIds) {
    const peers = fieldPeers.filter((peer) => peer.participantUserIds.includes(participantId));
    if (peers.length >= 2) return { blocked: true, phoneReuse: 0, longRouteCount: 0 };
    for (const peer of peers) {
      const evidence = routeEvidence(snapshot, candidate.preliminaryDate, target.id, peer.targetId);
      if ((!evidence && !allowMissingRouteEvidence)
          || (evidence && !evidence.sameAddress && (evidence.durationMinutes == null || evidence.durationMinutes > 60))) {
        return { blocked: true, phoneReuse: 0, longRouteCount: 0 };
      }
      if (evidence && !evidence.sameAddress && Number(evidence.durationMinutes) > 30) longRouteCount += 1;
    }
  }
  return { blocked: false, phoneReuse: 0, longRouteCount };
}

export function validateCandidateForSave(snapshot: PlanningSnapshot, target: PlannerTarget, candidate: PlannerCandidate) {
  const violations = validateCandidateHardRules(snapshot, target, candidate);
  const external = snapshot.existingSurveyOccupancy.filter((item) => item.targetId !== target.id);
  if (candidate.surveyMethod === "phone") {
    const count = external.filter((item) => item.surveyMethod === "phone"
      && item.preliminaryDate === candidate.preliminaryDate
      && item.responsibleUserId === candidate.responsibleUserId).length;
    if (count >= 3) violations.push("PHONE_RESPONSIBLE_CAPACITY_EXCEEDED");
  } else {
    const peers = external.filter((item) => item.surveyMethod === "field" && item.preliminaryDate === candidate.preliminaryDate);
    for (const participantId of candidate.participantUserIds) {
      const shared = peers.filter((peer) => peer.participantUserIds.includes(participantId));
      if (shared.length >= 2) violations.push("FIELD_VISIT_CAPACITY_EXCEEDED");
      for (const peer of shared) {
        const evidence = routeEvidence(snapshot, candidate.preliminaryDate, target.id, peer.targetId);
        if (!evidence || (!evidence.sameAddress && evidence.durationMinutes == null)) violations.push("ROUTE_EVIDENCE_REQUIRED");
        else if (!evidence.sameAddress && Number(evidence.durationMinutes) > 60) violations.push("FIELD_ROUTE_OVER_60_MINUTES");
      }
    }
  }
  return [...new Set(violations)].sort();
}

function solveBatch(
  snapshot: PlanningSnapshot,
  choices: Map<number, PlannerCandidate[]>,
  allowMissingRouteEvidence = false,
  deadlineAt?: number,
) {
  const targets = sortedTargets(snapshot).filter((target) => (choices.get(target.id)?.length ?? 0) > 0);
  const mutableTargetIds = new Set(targets.map((target) => target.id));
  let best = new Map<number, PlannerCandidate>();
  let bestObjective: PlannerObjective | null = null;
  let timedOut = false;
  const visit = (index: number, selected: Map<number, PlannerCandidate>, objective: PlannerObjective,
    selectedWriterCounts: Map<number, number>) => {
    if (deadlineAt != null && Date.now() >= deadlineAt) {
      timedOut = true;
      return;
    }
    if (bestObjective && compareObjective(objective, bestObjective) >= 0) return;
    if (index === targets.length) {
      best = new Map(selected);
      bestObjective = objective;
      return;
    }
    const target = targets[index];
    for (const candidate of choices.get(target.id) ?? []) {
      const conflict = conflictsWithSelected(snapshot, target, candidate, selected, mutableTargetIds, allowMissingRouteEvidence);
      if (conflict.blocked) continue;
      const selectedWriterCount = selectedWriterCounts.get(candidate.writerUserId) ?? 0;
      const writingLoad = Number(snapshot.writingCounters[String(candidate.writerUserId)] ?? 0) + selectedWriterCount;
      const dynamic: PlannerObjective = [0, 0, conflict.phoneReuse, 0, writingLoad, conflict.longRouteCount];
      selected.set(target.id, candidate);
      selectedWriterCounts.set(candidate.writerUserId, selectedWriterCount + 1);
      visit(index + 1, selected, addObjective(objective, addObjective(candidate.objective, dynamic)), selectedWriterCounts);
      if (selectedWriterCount === 0) selectedWriterCounts.delete(candidate.writerUserId);
      else selectedWriterCounts.set(candidate.writerUserId, selectedWriterCount);
      selected.delete(target.id);
    }
  };
  visit(0, new Map(), ZERO_OBJECTIVE, new Map());
  return { selected: timedOut ? new Map<number, PlannerCandidate>() : best, timedOut };
}

function protectedPublicCodeGroups(snapshot: PlanningSnapshot, normalized: ReturnType<typeof normalizePublicSampleCodes>) {
  const changedGroups = new Set<string>();
  for (const persisted of snapshot.existingPublicSampleAssignments.filter((item) => item.protected)) {
    const next = normalized.find((item) => item.targetId === persisted.targetId && item.measurementDate === persisted.measurementDate);
    if (next && next.publicSampleCode !== (persisted.publicSampleCode ?? persisted.surveyCode)) {
      changedGroups.add(`${persisted.measurementDate}|${persisted.assigneeUserId}`);
    }
  }
  return changedGroups;
}

export function planPreliminarySurveyGivenFixedAssignments(
  snapshot: PlanningSnapshot,
  options: { allowMissingRouteEvidence?: boolean; deadlineAt?: number } = {},
): ReversePlannerOutput {
  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  const errors = new Map<number, ReversePlannerReason>();
  const choices = new Map<number, PlannerCandidate[]>();
  const publicCodes = normalizePublicSampleCodes({
    targets: snapshot.targets,
    users: snapshot.users,
    existingAssignments: snapshot.existingPublicSampleAssignments,
  });
  const protectedCodeGroups = protectedPublicCodeGroups(snapshot, publicCodes);
  const routeBlocked = new Set<number>();
  const protectedGroupBlocked = new Set<number>();
  const transitionBlocked = new Set<number>();
  for (const target of sortedTargets(snapshot)) {
    if (isTransitionProtectedTarget(target)) { transitionBlocked.add(target.id); continue; }
    const error = sourceError(target, users);
    if (error) errors.set(target.id, error);
    else if (target.protected && !target.existingPlan) protectedGroupBlocked.add(target.id);
    else if (target.fixedAssignments.some((fixed) => protectedCodeGroups.has(`${fixed.measurementDate}|${fixed.assigneeUserId}`))) {
      protectedGroupBlocked.add(target.id);
    } else if (measurementRouteEvidenceMissing(snapshot, target, options.allowMissingRouteEvidence)) routeBlocked.add(target.id);
    else {
      const keep = existingCandidate(snapshot, target);
      choices.set(target.id, [...(keep ? [keep] : []), ...candidatesFor(snapshot, target)]);
    }
  }
  const solved = solveBatch(snapshot, choices, options.allowMissingRouteEvidence, options.deadlineAt);
  const selected = solved.selected;
  const results: ReversePlannerResult[] = sortedTargets(snapshot).map((target) => {
    const error = errors.get(target.id);
    const targetPublicCodes = publicCodes.filter((item) => item.targetId === target.id);
    const common = {
      targetId: target.id,
      code: target.code,
      fixedAssignments: target.fixedAssignments,
      publicSampleAssignments: targetPublicCodes,
      warnings: targetPublicCodes.some((item) => item.publicSampleCode.length > 3)
        ? ["PUBLIC_SAMPLE_HARD_RULE_EXCEEDED"] : [] as string[],
    };
    if (error) return { ...common, decision: error === "FIXED_ASSIGNEE_NOT_CONFIRMED" ? "MANUAL_REQUIRED" as const : "SOURCE_INVALID" as const,
      mutation: "NONE" as const, reason: error, candidate: null };
    if (transitionBlocked.has(target.id)) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "TRANSITION_BOUNDARY_REVIEW_REQUIRED" as const, candidate: null };
    if (routeBlocked.has(target.id)) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "ROUTE_EVIDENCE_REQUIRED" as const, candidate: null };
    if (protectedGroupBlocked.has(target.id)) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "PROTECTED_PLAN_REQUIRES_REVIEW" as const, candidate: null };
    if (solved.timedOut) return { ...common, decision: "MANUAL_REQUIRED" as const, mutation: "NONE" as const,
      reason: "ROUTE_EVIDENCE_REQUIRED" as const, candidate: null };
    const candidate = selected.get(target.id) ?? null;
    if (!candidate) return { ...common, decision: "MANUAL_REQUIRED" as const, mutation: "NONE" as const,
      reason: choices.get(target.id)?.length ? "ROUTE_EVIDENCE_REQUIRED" as const : emptyCandidateReason(snapshot, target), candidate: null };
    const keepExisting = candidate.reasons.includes("KEEP_EXISTING");
    if (target.protected && !keepExisting) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "PROTECTED_PLAN_REQUIRES_REVIEW" as const, candidate: null };
    return { ...common, decision: "AUTO_ASSIGNED" as const,
      mutation: keepExisting ? "KEEP_EXISTING" as const : target.existingPlan ? "REPLACE" as const : "CREATE" as const,
      reason: null, candidate };
  });
  return { results, sourceFingerprint: sourceFingerprint(snapshot), canonicalSha: snapshot.canonicalSha,
    plannerVersion: snapshot.plannerVersion, solverTimedOut: solved.timedOut || undefined };
}
