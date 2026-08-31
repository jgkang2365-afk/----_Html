import type { Availability } from "./types";

function reasons(availability: Availability, userId: number, date: string) {
  return availability.blockedReason?.(userId, date) ?? [];
}

export function isScheduleBlocked(availability: Availability, userId: number, date: string) {
  if (availability.isScheduleBlocked) return availability.isScheduleBlocked(userId, date);
  const blockedReasons = reasons(availability, userId, date);
  if (blockedReasons.length > 0) return blockedReasons.includes("USER_SCHEDULE_BLOCK") || blockedReasons.includes("PRELIMINARY_DATE_SCOPE_BLOCK");
  return availability.isBlocked(userId, date);
}

export function isActualMeasurementBlocked(availability: Availability, userId: number, date: string) {
  if (availability.isActualMeasurementBlocked) return availability.isActualMeasurementBlocked(userId, date);
  const blockedReasons = reasons(availability, userId, date);
  if (blockedReasons.length > 0) return blockedReasons.includes("ACTUAL_MEASUREMENT_CONFLICT");
  return availability.isBlocked(userId, date);
}

export function isFieldParticipantBlocked(availability: Availability, userId: number, date: string) {
  return isScheduleBlocked(availability, userId, date) || isActualMeasurementBlocked(availability, userId, date);
}

/** 기존업체 유선의 실제 수행자에게는 명시적 직원 불가 일정만 hard block이다. */
export function isExistingPhoneResponsibleBlocked(availability: Availability, userId: number, date: string) {
  return isScheduleBlocked(availability, userId, date);
}
