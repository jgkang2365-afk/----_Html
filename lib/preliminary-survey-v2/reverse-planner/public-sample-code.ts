import type { FixedMeasurementAssignment, PlannerTarget, PlannerUser, PublicSampleAssignment } from "./types";
const natural = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
export function normalizePublicSampleCodes(input: { targets: PlannerTarget[]; users: PlannerUser[]; fixedAssignments?: FixedMeasurementAssignment[] }): PublicSampleAssignment[] {
  const userById = new Map(input.users.map((user) => [user.id, user])); const targetById = new Map(input.targets.map((target) => [target.id, target]));
  const rows = (input.fixedAssignments ?? input.targets.flatMap((target) => target.fixedAssignments))
    .map((fixed) => ({ fixed, target: targetById.get(fixed.targetId), user: userById.get(fixed.assigneeUserId) }))
    .filter((item): item is typeof item & { target: PlannerTarget; user: PlannerUser } => Boolean(item.target && item.user?.baseCode));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) { const key = `${row.fixed.measurementDate}|${row.fixed.assigneeUserId}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return [...groups.values()].flatMap((group) => group.sort((a, b) => natural.compare(a.target.code, b.target.code) || a.target.id - b.target.id)
    .map((row, index) => ({ targetId: row.target.id, businessCode: row.target.code, measurementDate: row.fixed.measurementDate,
      assigneeUserId: row.fixed.assigneeUserId, surveyCode: row.user.baseCode!, publicSampleCode: row.user.baseCode!.repeat(index + 1) })))
    .sort((a, b) => a.measurementDate.localeCompare(b.measurementDate) || a.assigneeUserId - b.assigneeUserId
      || natural.compare(a.businessCode, b.businessCode) || a.targetId - b.targetId);
}
