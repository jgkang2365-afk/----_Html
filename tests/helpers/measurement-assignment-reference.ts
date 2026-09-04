import type {
  ExistingMeasurementAssignment,
  MeasurementAssigneeUser,
  MeasurementAssignmentTarget,
  MeasurementVehicleRouteEvidence,
} from "../../lib/preliminary-survey-v2/measurement-assignment";

export type ReferenceObjective = readonly [number, number, number, number, number, number, string];
export type ReferenceResult = { ids: number[]; objective: ReferenceObjective };

const address = (value: string | null) => String(value ?? "").replace(/\s+/g, "").trim();

export function exactMeasurementAssignmentReference(input: {
  targets: MeasurementAssignmentTarget[];
  users: MeasurementAssigneeUser[];
  existing?: ExistingMeasurementAssignment[];
  evidence?: MeasurementVehicleRouteEvidence[];
  blocked?: (userId: number, date: string) => boolean;
}): ReferenceResult | null {
  const targets = [...input.targets].sort((a, b) => a.measurementDate.localeCompare(b.measurementDate) || a.targetId - b.targetId);
  const users = input.users.filter((user) => user.active !== false && user.surveyCode != null)
    .sort((a, b) => String(a.surveyCode).localeCompare(String(b.surveyCode)) || a.id - b.id);
  let best: ReferenceResult | null = null;
  const ids: number[] = [];
  const participantUpper = new Array(targets.length + 1).fill(0);
  const reportUpper = new Array(targets.length + 1).fill(0);
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    participantUpper[index] = participantUpper[index + 1]
      + Math.max(...users.map((user) => Number(targets[index].measurementParticipantUserIds?.includes(user.id) ?? false)), 0);
    reportUpper[index] = reportUpper[index + 1]
      + Math.max(...users.map((user) => Number(targets[index].reportWriterUserId === user.id)), 0);
  }

  const duplicateMinutes = (target: MeasurementAssignmentTarget, userId: number) => {
    const prior = [
      ...(input.existing ?? []).filter((item) => item.userId === userId && item.measurementDate === target.measurementDate),
      ...targets.slice(0, ids.length).filter((_, index) => ids[index] === userId),
    ];
    if (!prior.length) return 0;
    if (prior.some((item) => address(item.address) && address(item.address) === address(target.address))) return 0;
    const minutes = prior.flatMap((item) => (input.evidence ?? []).filter((route) => route.allowed
      && route.source === "vehicle" && route.durationMinutes != null
      && ((route.fromTargetId === target.targetId && route.toTargetId === item.targetId)
        || (route.toTargetId === target.targetId && route.fromTargetId === item.targetId)))
      .map((route) => route.durationMinutes as number));
    return minutes.length ? Math.min(...minutes) : Number.POSITIVE_INFINITY;
  };
  const compare = (a: ReferenceObjective, b: ReferenceObjective) => {
    for (let index = 0; index < 6; index += 1) if (a[index] !== b[index]) return Number(a[index]) - Number(b[index]);
    return a[6].localeCompare(b[6]);
  };
  const visit = (index: number, participant: number, report: number, route: number) => {
    const prefixCounts = users.map((user) => (input.existing ?? []).filter((item) => item.userId === user.id
      && item.measurementDate === targets[0]?.measurementDate).length + ids.filter((id) => id === user.id).length);
    const zeroCount = prefixCounts.filter((count) => count === 0).length;
    const hasOrdinaryDuplicate = zeroCount > 0 && users.some((user, userIndex) => {
      const existing = (input.existing ?? []).filter((item) => item.userId === user.id
        && item.measurementDate === targets[0]?.measurementDate);
      if (prefixCounts[userIndex] <= Math.max(existing.length, 1)) return false;
      const assignedTargets = targets.slice(0, ids.length).filter((_, targetIndex) => ids[targetIndex] === user.id);
      const combined = [...existing, ...assignedTargets];
      return combined.length !== 2 || !address(combined[0].address)
        || address(combined[0].address) !== address(combined[1].address);
    });
    if (hasOrdinaryDuplicate && zeroCount > targets.length - index) return;
    if (index === targets.length) {
      const counts = users.map((user) => (input.existing ?? []).filter((item) => item.userId === user.id
        && item.measurementDate === targets[0]?.measurementDate).length + ids.filter((id) => id === user.id).length);
      if (counts.some((count) => count === 0) && users.some((user, userIndex) => {
        const existing = (input.existing ?? []).filter((item) => item.userId === user.id
          && item.measurementDate === targets[0]?.measurementDate);
        const assignedTargets = targets.filter((_, targetIndex) => ids[targetIndex] === user.id);
        if (counts[userIndex] <= Math.max(existing.length, 1)) return false;
        const combined = [...existing, ...assignedTargets];
        return combined.length !== 2 || !address(combined[0].address)
          || address(combined[0].address) !== address(combined[1].address);
      })) return;
      const total = counts.reduce((sum, count) => sum + count, 0);
      const variance = counts.reduce((sum, count) => sum + Math.abs(count * counts.length - total), 0);
      const objective: ReferenceObjective = [-participant, -report, route, Math.max(...counts, 0), variance,
        counts.filter((count) => count > 1).length, ids.map((id) => id.toString().padStart(8, "0")).join("")];
      if (!best || compare(objective, best.objective) < 0) best = { ids: [...ids], objective };
      return;
    }
    if (best) {
      const bestParticipant = -best.objective[0];
      const bestReport = -best.objective[1];
      if (participant + participantUpper[index] < bestParticipant) return;
      if (participant + participantUpper[index] === bestParticipant && report + reportUpper[index] < bestReport) return;
      if (participant + participantUpper[index] === bestParticipant
        && report + reportUpper[index] === bestReport && route > best.objective[2]) return;
    }
    const target = targets[index];
    for (const user of users) {
      if (input.blocked?.(user.id, target.measurementDate)) continue;
      const prior = [
        ...(input.existing ?? []).filter((item) => item.userId === user.id && item.measurementDate === target.measurementDate),
        ...targets.slice(0, ids.length).filter((_, priorIndex) => ids[priorIndex] === user.id),
      ];
      const count = prior.length;
      if (count >= 2) continue;
      const counts = users.map((candidate) => (input.existing ?? []).filter((item) => item.userId === candidate.id
        && item.measurementDate === target.measurementDate).length + ids.filter((id) => id === candidate.id).length);
      const minutes = duplicateMinutes(target, user.id);
      if (!Number.isFinite(minutes)) continue;
      ids.push(user.id);
      visit(index + 1, participant + Number(target.measurementParticipantUserIds?.includes(user.id) ?? false),
        report + Number(target.reportWriterUserId === user.id), route + minutes);
      ids.pop();
    }
  };
  visit(0, 0, 0, 0);
  return best as ReferenceResult | null;
}
