import { samePhysicalSite } from "../same-site";
import { normalizePublicSampleCodes } from "./public-sample-code";
import type { FixedMeasurementAssignment, PlannerTarget, PlanningSnapshot } from "./types";

export type AdminMeasurementChoice = { measurementDate: string; assigneeUserId: number };
export type PublicCodeImpact = {
  targetId: number; businessCode: string; measurementDate: string;
  beforeAssigneeUserId: number; afterAssigneeUserId: number;
  beforeCode: string; afterCode: string;
};

export function prepareAdminMeasurementEdit(snapshot: PlanningSnapshot, target: PlannerTarget, choices: unknown) {
  if (!target.existingPlan || !Array.isArray(choices) || choices.length !== target.days.length) {
    return { error: "실제 측정일별 공시료 담당자 원천을 확인해야 합니다." } as const;
  }
  const days = new Set(target.days.map((day) => day.date));
  const parsed = choices as AdminMeasurementChoice[];
  const selected = new Map<string, number>();
  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  for (const item of parsed) {
    if (!item || typeof item.measurementDate !== "string" || !days.has(item.measurementDate)
      || selected.has(item.measurementDate) || !Number.isInteger(item.assigneeUserId)
      || !users.get(item.assigneeUserId)?.active || !/^[ABCDFG]$/.test(users.get(item.assigneeUserId)?.baseCode ?? "")) {
      return { error: "공시료 담당자 또는 측정일 입력값이 유효하지 않습니다." } as const;
    }
    selected.set(item.measurementDate, item.assigneeUserId);
  }
  const before = new Map(target.existingPlan.assignments.map((item) => [item.measurementDate, item]));
  if (target.days.some((day) => !before.has(day.date))) {
    return { error: "기존 날짜별 공시료 배정 원천이 부족합니다." } as const;
  }
  const changedDates = target.days.filter((day) => before.get(day.date)!.assigneeUserId !== selected.get(day.date))
    .map((day) => day.date);
  const affectedDates = new Set(changedDates);
  const persisted = snapshot.targets.flatMap((item) => (item.existingPlan?.assignments ?? []).map((assignment) => ({
    targetId: item.id, businessCode: item.code, measurementDate: assignment.measurementDate,
    assigneeUserId: assignment.assigneeUserId, surveyCode: assignment.surveyCode,
    publicSampleCode: assignment.publicSampleCode, protected: item.protected === true,
    source: "persisted" as const, updatedAt: assignment.updatedAt ?? "",
  })));
  const persistedKeys = new Set(persisted.map((item) => `${item.targetId}|${item.measurementDate}`));
  const fixedRows = snapshot.targets.flatMap((item) => item.fixedAssignments.filter((fixed) => fixed.origin !== "automatic").map((fixed) => ({
    targetId: item.id, measurementDate: fixed.measurementDate,
    assigneeUserId: fixed.assigneeUserId, updatedAt: fixed.updatedAt,
  })));
  const fixedOnly = fixedRows.filter((item) => !persistedKeys.has(`${item.targetId}|${item.measurementDate}`));
  const proposals: FixedMeasurementAssignment[] = target.days.map((day) => ({
    targetId: target.id, measurementDate: day.date, assigneeUserId: selected.get(day.date)!,
    confirmedAt: "admin-preview", updatedAt: "admin-preview", origin: "automatic",
  }));
  const normalized = normalizePublicSampleCodes({ targets: snapshot.targets, users: snapshot.users,
    fixedAssignments: [...proposals, ...fixedOnly.map((item) => ({
      targetId: item.targetId, measurementDate: item.measurementDate, assigneeUserId: item.assigneeUserId,
      confirmedAt: item.updatedAt, updatedAt: item.updatedAt,
    }))], existingAssignments: persisted });
  const normalizedByKey = new Map(normalized.map((item) => [`${item.targetId}|${item.measurementDate}`, item]));
  const affectedGroups = new Set(changedDates.flatMap((date) => [
    `${date}|${before.get(date)!.assigneeUserId}`, `${date}|${selected.get(date)}`,
  ]));
  const impacts: PublicCodeImpact[] = [];
  for (const row of persisted.filter((item) => affectedGroups.has(`${item.measurementDate}|${item.assigneeUserId}`)
    || (item.targetId === target.id && affectedDates.has(item.measurementDate)))) {
    const next = normalizedByKey.get(`${row.targetId}|${row.measurementDate}`);
    if (!next) return { error: "영향 그룹의 공시료 코드를 계산할 수 없습니다." } as const;
    const beforeCode = row.publicSampleCode ?? row.surveyCode;
    if (row.assigneeUserId !== next.assigneeUserId || beforeCode !== next.publicSampleCode) impacts.push({
      targetId: row.targetId, businessCode: row.businessCode, measurementDate: row.measurementDate,
      beforeAssigneeUserId: row.assigneeUserId, afterAssigneeUserId: next.assigneeUserId,
      beforeCode, afterCode: next.publicSampleCode,
    });
  }
  if (impacts.some((item) => snapshot.targets.find((other) => other.id === item.targetId)?.historicalProtected)) {
    return { error: "역사 보호 자료의 공시료 코드가 바뀌므로 저장할 수 없습니다." } as const;
  }
  const violations: string[] = [];
  const evidenceRequired: string[] = [];
  const currentRows = [...persisted, ...fixedOnly].filter((item) => !affectedDates.has(item.measurementDate)
    || item.targetId !== target.id);
  for (const date of changedDates) {
    const chosen = selected.get(date)!;
    const day = target.days.find((item) => item.date === date)!;
    if (!day.collaboratorUserIds.includes(chosen)) violations.push("MEASUREMENT_ASSIGNEE_NON_PARTICIPANT");
    if (snapshot.scheduleBlocks.some((block) => block.userId === chosen && block.startDate <= date && date <= block.endDate)) {
      violations.push("MEASUREMENT_ASSIGNEE_UNAVAILABLE");
    }
    const peers = currentRows.filter((item) => item.measurementDate === date && item.assigneeUserId === chosen);
    if (peers.length >= 3) return { error: "같은 날짜에 한 사람이 4건 이상 공시료를 담당할 수 없습니다." } as const;
    if (peers.length >= 2) violations.push("MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE");
    for (const peer of peers) {
      const other = snapshot.targets.find((item) => item.id === peer.targetId);
      if (!other) return { error: "영향 업체의 실제 측정 원천을 확인할 수 없습니다." } as const;
      if (samePhysicalSite({ address: target.address, coordinate: target.coordinate ?? null },
        { address: other.address, coordinate: other.coordinate ?? null })) continue;
      const evidence = snapshot.routeEvidence.find((item) => item.date === date
        && [item.leftTargetId, item.rightTargetId].includes(target.id)
        && [item.leftTargetId, item.rightTargetId].includes(peer.targetId));
      if (!evidence || evidence.durationMinutes == null) evidenceRequired.push("MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED");
      else if (evidence.durationMinutes > 60) violations.push("MEASUREMENT_ASSIGNMENT_ROUTE_OVER_60_MINUTES");
    }
  }
  const assignments = changedDates.map((date) => {
    const next = normalizedByKey.get(`${target.id}|${date}`)!;
    return { target_id: target.id, measurement_date: date, assignee_user_id: next.assigneeUserId,
      survey_code: next.surveyCode, public_sample_code: next.publicSampleCode,
      assignment_origin: "admin_override" };
  });
  const groupDates = [...affectedDates].sort();
  const sourceAssignments = persisted.filter((item) => affectedDates.has(item.measurementDate))
    .map((item) => ({ targetId: item.targetId, measurementDate: item.measurementDate,
      assigneeUserId: item.assigneeUserId, publicSampleCode: item.publicSampleCode,
      surveyCode: item.surveyCode,
      updatedAtMs: new Date(item.updatedAt).getTime() }))
    .sort((a, b) => a.measurementDate.localeCompare(b.measurementDate) || a.targetId - b.targetId);
  const sourceFixed = fixedRows.filter((item) => affectedDates.has(item.measurementDate))
    .map((item) => ({ targetId: item.targetId, measurementDate: item.measurementDate,
      assigneeUserId: item.assigneeUserId, updatedAtMs: new Date(item.updatedAt).getTime() }))
    .sort((a, b) => a.measurementDate.localeCompare(b.measurementDate) || a.targetId - b.targetId);
  return { changedDates, groupDates, assignments, impacts, selected: [...selected.entries()].map(([measurementDate, assigneeUserId]) => ({ measurementDate, assigneeUserId })),
    violations: [...new Set(violations)].sort(), evidenceRequired: [...new Set(evidenceRequired)].sort(),
    sourceAssignments, sourceFixed } as const;
}
