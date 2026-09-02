import { assignMeasurementAssignees, type SurveyCode } from "../measurement-assignment";
import type { FixedMeasurementAssignment, PlanningSnapshot } from "./types";

const surveyCodes = new Set(["A", "B", "C", "D", "F", "G"]);

/**
 * 명시적으로 고정되지 않은 측정일만 기존 결정론적 측정자 배정기로 채운다.
 * 이 값은 Preview/Apply 계산용이며 fixed confirmation row로 저장하지 않는다.
 */
export function withAutomaticMeasurementAssignments(snapshot: PlanningSnapshot): PlanningSnapshot {
  const missing = snapshot.targets.flatMap((target) => target.days
    .filter((day) => !target.fixedAssignments.some((fixed) => fixed.measurementDate === day.date))
    .map((day) => ({
      targetId: target.id,
      measurementDate: day.date,
      address: target.address,
      coordinate: target.coordinate ?? null,
      businessCode: target.code,
      reportWriterUserId: day.reportWriterUserId,
      measurementParticipantUserIds: day.collaboratorUserIds,
    })));
  if (!missing.length) return snapshot;

  const missingKeys = new Set(missing.map((item) => `${item.targetId}|${item.measurementDate}`));
  const explicit = snapshot.targets.flatMap((target) => target.fixedAssignments.map((fixed) => ({
    targetId: target.id,
    measurementDate: fixed.measurementDate,
    address: target.address,
    coordinate: target.coordinate ?? null,
    businessCode: target.code,
    userId: fixed.assigneeUserId,
  })));
  const existing = snapshot.existingPublicSampleAssignments
    .filter((item) => !missingKeys.has(`${item.targetId}|${item.measurementDate}`))
    .map((item) => ({
      targetId: item.targetId,
      measurementDate: item.measurementDate,
      address: null,
      coordinate: null,
      businessCode: item.businessCode,
      userId: item.assigneeUserId,
    }));

  let automatic: FixedMeasurementAssignment[] = [];
  try {
    automatic = assignMeasurementAssignees({
      targets: missing,
      users: snapshot.users.map((user) => ({
        id: user.id,
        name: user.name,
        surveyCode: surveyCodes.has(user.baseCode ?? "") ? user.baseCode as SurveyCode : null,
        active: user.active,
      })),
      existing: [...existing, ...explicit],
      availability: {
        isBlocked: (userId, date) => snapshot.scheduleBlocks.some((block) =>
          block.userId === userId && block.startDate <= date && block.endDate >= date),
      },
    }).map((item) => ({
      targetId: item.targetId,
      measurementDate: item.measurementDate,
      assigneeUserId: item.userId,
      confirmedAt: "automatic-preview",
      updatedAt: "automatic-preview",
      origin: "automatic" as const,
    }));
  } catch {
    // 자동 측정자를 안전하게 완성할 수 없는 batch는 기존 solver가 수동 확인 대상으로 판정한다.
    return snapshot;
  }

  const automaticByTarget = new Map<number, FixedMeasurementAssignment[]>();
  for (const assignment of automatic) {
    automaticByTarget.set(assignment.targetId, [
      ...(automaticByTarget.get(assignment.targetId) ?? []),
      assignment,
    ]);
  }
  const targets = snapshot.targets.map((target) => ({
    ...target,
    fixedAssignments: [...target.fixedAssignments, ...(automaticByTarget.get(target.id) ?? [])]
      .sort((left, right) => left.measurementDate.localeCompare(right.measurementDate)),
  }));
  const automaticByDay = new Map(automatic.map((item) => [
    `${item.targetId}|${item.measurementDate}`,
    item.assigneeUserId,
  ]));
  const actualMeasurementOccupancy = snapshot.actualMeasurementOccupancy.map((item) => {
    const automaticUserId = automaticByDay.get(`${item.targetId}|${item.date}`);
    return automaticUserId == null ? item : {
      ...item,
      participantUserIds: [...new Set([...item.participantUserIds, automaticUserId])]
        .sort((left, right) => left - right),
    };
  });
  return { ...snapshot, targets, actualMeasurementOccupancy };
}
