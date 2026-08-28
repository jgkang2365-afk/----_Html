import { surveyMethodForKind, type ExistingAssignment } from "./types";

export const EXISTING_PHONE_RESPONSIBLE_DAILY_LIMIT = 3;

export function responsiblePhoneCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((assignment) =>
    assignment.date === date && assignment.responsibleUserId === userId &&
    (assignment.surveyMethod ?? surveyMethodForKind(assignment.kind)) === "phone",
  ).length;
}

export function fitsExistingPhoneResponsibleLimit(
  assignments: ExistingAssignment[], userId: number, date: string,
) {
  return responsiblePhoneCount(assignments, userId, date) < EXISTING_PHONE_RESPONSIBLE_DAILY_LIMIT;
}
