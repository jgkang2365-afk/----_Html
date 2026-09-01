import { candidateDates, isScheduleBlocked } from "./candidate-dates";
import { sourceFingerprint } from "./fingerprint";
import { normalizePublicSampleCodes } from "./public-sample-code";
import type { ExistingPlannerPlan, PlannerCandidate, PlannerTarget, PlannerUser, PlanningSnapshot, ReversePlannerReason, ReversePlannerResult, ReversePlannerOutput } from "./types";

const natural = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const reviewerPreference: Record<string, string> = { "강종구": "이태환", "고유빈": "이주형", "김민영": "한기문" };
const sortedTargets = (snapshot: PlanningSnapshot) => [...snapshot.targets].sort((a, b) => natural.compare(a.code, b.code) || a.id - b.id);

function sourceError(target: PlannerTarget, users: Map<number, PlannerUser>): ReversePlannerReason | null {
  if (!target.days.length || target.days.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day.date))) return "INVALID_MEASUREMENT_DATES";
  if (new Set(target.days.map((day) => day.date)).size !== target.days.length) return "INVALID_DAILY_STAFF";
  if ("sourceReportWriterUserId" in target && target.sourceReportWriterUserId == null) return "CONFLICTING_AUTHORITATIVE_SOURCE";
  if (target.fixedAssignments.length !== target.days.length) return "FIXED_ASSIGNEE_NOT_CONFIRMED";
  for (const day of target.days) {
    const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date);
    if (!fixed) return "FIXED_ASSIGNEE_NOT_CONFIRMED"; const user = users.get(fixed.assigneeUserId);
    if (!user) return "USER_NOT_FOUND"; if (!user.active || !user.baseCode || !/^[A-Z]$/.test(user.baseCode)) return "INVALID_BASE_CODE";
  }
  return null;
}

function actualTeam(target: PlannerTarget) {
  const team = new Set<number>();
  for (const day of target.days) { day.collaboratorUserIds.forEach((id) => team.add(id));
    const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date); if (fixed) team.add(fixed.assigneeUserId); }
  return team;
}

function candidatesFor(snapshot: PlanningSnapshot, target: PlannerTarget): PlannerCandidate[] {
  const active = snapshot.users.filter((user) => user.active); const experienced = active.filter((user) => user.experienced);
  const inexperienced = active.filter((user) => !user.experienced); const team = actualTeam(target);
  const reportWriterIds = new Set(target.days.map((day) => day.reportWriterUserId).filter((id): id is number => id != null));
  const measurementDate = [...target.days].sort((a, b) => a.date.localeCompare(b.date))[0].date;
  const ranges = candidateDates(measurementDate, target.businessType);
  const combinations: Array<{ participants: PlannerUser[]; responsible: PlannerUser; reviewer: PlannerUser | null; writer: PlannerUser; score: number }> = [];
  experienced.filter((user) => team.has(user.id)).forEach((user) => combinations.push({ participants: [user], responsible: user, reviewer: null, writer: user, score: 10 }));
  for (const novice of inexperienced) for (const reviewer of experienced) {
    if (!team.has(novice.id) && !team.has(reviewer.id)) continue;
    combinations.push({ participants: [reviewer, novice], responsible: novice, reviewer, writer: novice,
      score: (reviewerPreference[reviewer.name] === novice.name ? 0 : 5)
        - Number(reportWriterIds.has(novice.id) || reportWriterIds.has(reviewer.id)) * 2 });
  }
  return combinations.flatMap((choice) => {
    const ids = choice.participants.map((user) => user.id); const available = (dates: string[]) => dates.filter((date) => ids.every((id) => !isScheduleBlocked(id, date, snapshot.scheduleBlocks)));
    const primary = available(ranges.primary); const dates = primary.length ? primary : available(ranges.fallback);
    return dates.map((date, index) => ({ preliminaryDate: date, surveyMethod: target.businessType === "existing" ? "phone" as const : "field" as const,
      participantUserIds: ids, responsibleUserId: choice.responsible.id, reviewerUserId: choice.reviewer?.id ?? null,
      writerUserId: choice.writer.id, score: choice.score + index + Number(snapshot.writingCounters[String(choice.writer.id)] ?? 0) * 100,
      reasons: [primary.length ? "PRIMARY_DATE" : "FALLBACK_DATE", choice.reviewer ? "EXPERIENCED_AND_INEXPERIENCED" : "EXPERIENCED_SOLO"] }));
  }).sort((a, b) => a.score - b.score || a.preliminaryDate.localeCompare(b.preliminaryDate) || a.responsibleUserId - b.responsibleUserId);
}

function emptyCandidateReason(snapshot: PlanningSnapshot, target: PlannerTarget): ReversePlannerReason {
  const active = snapshot.users.filter((user) => user.active);
  const experienced = active.filter((user) => user.experienced);
  if (!experienced.length) return "NO_EXPERIENCED_PARTNER_AVAILABLE";
  const team = actualTeam(target);
  const hasCanonicalTeamCombination = experienced.some((user) => team.has(user.id))
    || active.some((user) => !user.experienced && team.has(user.id));
  const measurementDate = [...target.days].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? "";
  const ranges = candidateDates(measurementDate, target.businessType);
  const dates = [...ranges.primary, ...ranges.fallback];
  const hasAvailableMismatch = experienced.some((user) =>
    !team.has(user.id) && dates.some((date) => !isScheduleBlocked(user.id, date, snapshot.scheduleBlocks))
  );
  if (hasCanonicalTeamCombination && hasAvailableMismatch) return "ONLY_MISMATCH_ALTERNATIVES_AVAILABLE";
  return hasCanonicalTeamCombination
    ? "NO_VALID_PRELIMINARY_DATE"
    : "ONLY_MISMATCH_ALTERNATIVES_AVAILABLE";
}

function touchesProtectedPublicCodeGroup(snapshot: PlanningSnapshot, target: PlannerTarget) {
  const protectedGroups = new Set(snapshot.targets.flatMap((item) =>
    item.existingPlan?.protected
      ? item.existingPlan.assignments.map((assignment) => `${assignment.measurementDate}|${assignment.assigneeUserId}`)
      : []
  ));
  return target.fixedAssignments.some((fixed) =>
    protectedGroups.has(`${fixed.measurementDate}|${fixed.assigneeUserId}`)
    && !target.existingPlan?.protected
  );
}

function isTransitionProtectedTarget(target: PlannerTarget) {
  return target.days.some((day) => day.date.startsWith("2026-08-"));
}

function existingAssignmentsCompatible(target: PlannerTarget, plan: ExistingPlannerPlan | null) {
  if (!plan?.preliminaryDate || !plan.participantUserIds.some((id) => actualTeam(target).has(id))) return false;
  const fixed = new Map(target.fixedAssignments.map((item) => [item.measurementDate, item.assigneeUserId]));
  return plan.assignments.length === target.days.length && plan.assignments.every((item) => fixed.get(item.measurementDate) === item.assigneeUserId);
}

function existingCandidate(snapshot: PlanningSnapshot, target: PlannerTarget): PlannerCandidate | null {
  const plan = target.existingPlan;
  if (!plan?.preliminaryDate || !existingAssignmentsCompatible(target, plan)) return null;
  const userById = new Map(snapshot.users.map((user) => [user.id, user]));
  const participants = plan.participantUserIds.map((id) => userById.get(id)).filter((user): user is PlannerUser => Boolean(user?.active));
  if (participants.length !== plan.participantUserIds.length) return null;
  const experienced = participants.filter((user) => user.experienced);
  const inexperienced = participants.filter((user) => !user.experienced);
  if (!((experienced.length === 1 && inexperienced.length === 0)
      || (experienced.length === 1 && inexperienced.length === 1))) return null;
  if (participants.some((user) => isScheduleBlocked(user.id, plan.preliminaryDate!, snapshot.scheduleBlocks))) return null;
  const ranges = candidateDates(target.days[0]?.date ?? "", target.businessType);
  if (![...ranges.primary, ...ranges.fallback].includes(plan.preliminaryDate)) return null;
  if (plan.surveyMethod !== (target.businessType === "existing" ? "phone" : "field")) return null;
  const responsible = userById.get(plan.responsibleUserId);
  if (!responsible || !participants.some((user) => user.id === responsible.id)) return null;
  return {
    preliminaryDate: plan.preliminaryDate,
    surveyMethod: plan.surveyMethod,
    participantUserIds: plan.participantUserIds,
    responsibleUserId: plan.responsibleUserId,
    reviewerUserId: plan.reviewerUserId,
    writerUserId: inexperienced[0]?.id ?? experienced[0].id,
    score: -10_000,
    reasons: ["KEEP_EXISTING"],
  };
}

function measurementRouteEvidenceMissing(snapshot: PlanningSnapshot, target: PlannerTarget) {
  for (const other of snapshot.targets) {
    if (other.id === target.id) continue;
    for (const day of target.days) {
      const otherDay = other.days.find((item) => item.date === day.date);
      if (!otherDay) continue;
      const targetTeam = new Set([
        ...day.collaboratorUserIds,
        ...target.fixedAssignments.filter((item) => item.measurementDate === day.date).map((item) => item.assigneeUserId),
      ]);
      const otherTeam = new Set([
        ...otherDay.collaboratorUserIds,
        ...other.fixedAssignments.filter((item) => item.measurementDate === day.date).map((item) => item.assigneeUserId),
      ]);
      if (![...targetTeam].some((id) => otherTeam.has(id))) continue;
      const evidence = snapshot.routeEvidence.find((item) => item.date === day.date
        && [item.leftTargetId, item.rightTargetId].includes(target.id)
        && [item.leftTargetId, item.rightTargetId].includes(other.id));
      if (!evidence || (!evidence.sameAddress && evidence.durationMinutes == null)) return true;
    }
  }
  return false;
}

function solveBatch(snapshot: PlanningSnapshot, choices: Map<number, PlannerCandidate[]>) {
  const targets = sortedTargets(snapshot).filter((target) => (choices.get(target.id)?.length ?? 0) > 0);
  let best = new Map<number, PlannerCandidate>(); let bestScore = Number.POSITIVE_INFINITY;
  const visit = (index: number, selected: Map<number, PlannerCandidate>, score: number) => {
    if (score >= bestScore) return; if (index === targets.length) { best = new Map(selected); bestScore = score; return; }
    const target = targets[index];
    for (const candidate of choices.get(target.id) ?? []) {
      const sameField = [...selected.entries()].filter(([, item]) => item.surveyMethod === "field" && item.preliminaryDate === candidate.preliminaryDate);
      let routePenalty = 0;
      if (candidate.surveyMethod === "field" && sameField.length) {
        if (sameField.length >= 2) continue;
        const otherId = sameField[0][0]; const evidence = snapshot.routeEvidence.find((item) => item.date === candidate.preliminaryDate
          && [item.leftTargetId, item.rightTargetId].includes(target.id) && [item.leftTargetId, item.rightTargetId].includes(otherId));
        if (!evidence || (!evidence.sameAddress && (evidence.durationMinutes == null || evidence.durationMinutes > 60))) continue;
        routePenalty = !evidence.sameAddress && Number(evidence.durationMinutes) > 30 ? 500 : 0;
      }
      const phoneCount = [...selected.values()].filter((item) => item.surveyMethod === "phone" && item.preliminaryDate === candidate.preliminaryDate
        && item.responsibleUserId === candidate.responsibleUserId).length;
      if (candidate.surveyMethod === "phone" && phoneCount >= 3) continue;
      const sameExistingDate = [...selected.values()].filter((item) =>
        item.surveyMethod === "phone" && item.preliminaryDate === candidate.preliminaryDate
      ).length;
      selected.set(target.id, candidate);
      visit(index + 1, selected, score + candidate.score + routePenalty
        + (candidate.surveyMethod === "phone" ? sameExistingDate * 1_000 : 0));
      selected.delete(target.id);
    }
  };
  visit(0, new Map(), 0); return best;
}

export function planPreliminarySurveyGivenFixedAssignments(snapshot: PlanningSnapshot): ReversePlannerOutput {
  const users = new Map(snapshot.users.map((user) => [user.id, user])); const errors = new Map<number, ReversePlannerReason>();
  const choices = new Map<number, PlannerCandidate[]>(); const publicCodes = normalizePublicSampleCodes({ targets: snapshot.targets, users: snapshot.users });
  const routeBlocked = new Set<number>(); const protectedGroupBlocked = new Set<number>(); const transitionBlocked = new Set<number>();
  for (const target of sortedTargets(snapshot)) {
    if (isTransitionProtectedTarget(target)) { transitionBlocked.add(target.id); continue; }
    const error = sourceError(target, users);
    if (error) errors.set(target.id, error);
    else if (touchesProtectedPublicCodeGroup(snapshot, target)) protectedGroupBlocked.add(target.id);
    else if (measurementRouteEvidenceMissing(snapshot, target)) routeBlocked.add(target.id);
    else {
      const keep = existingCandidate(snapshot, target);
      choices.set(target.id, [...(keep ? [keep] : []), ...candidatesFor(snapshot, target)]);
    }
  }
  const selected = solveBatch(snapshot, choices);
  const results: ReversePlannerResult[] = sortedTargets(snapshot).map((target) => {
    const error = errors.get(target.id);
    const targetPublicCodes = publicCodes.filter((item) => item.targetId === target.id);
    const common = { targetId: target.id, code: target.code, fixedAssignments: target.fixedAssignments,
      publicSampleAssignments: targetPublicCodes,
      warnings: targetPublicCodes.some((item) => item.publicSampleCode.length > 3)
        ? ["PUBLIC_SAMPLE_HARD_RULE_EXCEEDED"] : [] as string[] };
    if (error) return { ...common, decision: error === "FIXED_ASSIGNEE_NOT_CONFIRMED" ? "MANUAL_REQUIRED" as const : "SOURCE_INVALID" as const,
      mutation: "NONE" as const, reason: error, candidate: null };
    if (transitionBlocked.has(target.id)) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "TRANSITION_BOUNDARY_REVIEW_REQUIRED" as const, candidate: null };
    if (routeBlocked.has(target.id)) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "ROUTE_EVIDENCE_REQUIRED" as const, candidate: null };
    if (protectedGroupBlocked.has(target.id)) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "PROTECTED_PLAN_REQUIRES_REVIEW" as const, candidate: null };
    const candidate = selected.get(target.id) ?? null;
    if (!candidate) return { ...common, decision: "MANUAL_REQUIRED" as const, mutation: "NONE" as const,
      reason: (choices.get(target.id)?.length ? "ROUTE_EVIDENCE_REQUIRED" : emptyCandidateReason(snapshot, target)), candidate: null };
    const keepExisting = candidate.reasons.includes("KEEP_EXISTING");
    if (target.existingPlan?.protected && !keepExisting) return { ...common, decision: "MANUAL_REQUIRED" as const,
      mutation: "NONE" as const, reason: "PROTECTED_PLAN_REQUIRES_REVIEW" as const, candidate: null };
    return { ...common, decision: "AUTO_ASSIGNED" as const,
      mutation: keepExisting ? "KEEP_EXISTING" as const : target.existingPlan ? "REPLACE" as const : "CREATE" as const,
      reason: null, candidate };
  });
  return { results, sourceFingerprint: sourceFingerprint(snapshot), canonicalSha: snapshot.canonicalSha, plannerVersion: snapshot.plannerVersion };
}
