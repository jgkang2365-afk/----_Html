import {
  measurementDayFormsFrom,
  MeasurementDayForm,
  normalizeMeasurementCollaborators,
} from "./measurement-day-form";
import { buildScheduleBlockKeys } from "../preliminary-survey-v2/availability";
import { parseDateOnly } from "../preliminary-survey-v2/calendar";

export interface ScheduleBlockRange {
  user_id: number | string;
  start_date: string;
  end_date: string;
}

export interface MeasurementStaffUser {
  id: number;
  name: string;
}

export function buildMeasurementScheduleBlockKeys(blocks: ScheduleBlockRange[]): Set<string> {
  return buildScheduleBlockKeys(blocks
    .map((block) => ({ ...block, user_id: Number(block.user_id) }))
    .filter((block) => Number.isInteger(block.user_id) && block.user_id > 0));
}

export function isMeasurementStaffUnavailable(
  userId: number,
  date: string | null | undefined,
  blockedKeys: Set<string>,
) {
  return Boolean(date) && blockedKeys.has(`${userId}:${date}`);
}

/**
 * 사업장 원천의 보고서 담당자·측정 참여자를 날짜별 불가 일정 키로 만든다.
 * daily_staff가 있으면 그 날짜별 참여자만 사용하고, 단일일은 배열·CSV 모두 정규화한다.
 */
export function measurementDayAvailabilityKeys(input: {
  dailyStaff?: unknown;
  measurementDate?: string | null;
  measurerId?: number | null;
  collaborators?: unknown;
  userIdByName: Map<string, number>;
}): string[] {
  const keys = new Set<string>();
  for (const day of measurementDayFormsFrom(input)) {
    if (!parseDateOnly(day.date)) continue;
    if (day.measurerId != null) keys.add(`${day.measurerId}:${day.date}`);
    for (const name of normalizeMeasurementCollaborators(day.collaborators)) {
      const userId = input.userIdByName.get(name);
      if (userId != null && Number.isInteger(userId) && userId > 0) keys.add(`${userId}:${day.date}`);
    }
  }
  return [...keys];
}

export function validateMeasurementDayAvailability(input: {
  days: MeasurementDayForm[];
  users: MeasurementStaffUser[];
  blockedKeys: Set<string>;
}) {
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const usersByName = new Map(input.users.map((user) => [user.name.trim(), user]));
  const conflicts: string[] = [];

  input.days.forEach((day, index) => {
    if (!day.date) return;
    const reportWriter = day.measurerId == null ? null : usersById.get(day.measurerId);
    if (reportWriter && isMeasurementStaffUnavailable(reportWriter.id, day.date, input.blockedKeys)) {
      conflicts.push(`측정일 ${index + 1}(${day.date}) 보고서 담당자 ${reportWriter.name}`);
    }
    for (const name of normalizeMeasurementCollaborators(day.collaborators)) {
      const participant = usersByName.get(name);
      if (participant && isMeasurementStaffUnavailable(participant.id, day.date, input.blockedKeys)) {
        conflicts.push(`측정일 ${index + 1}(${day.date}) 측정 참여자 ${participant.name}`);
      }
    }
  });

  return conflicts.length === 0
    ? { valid: true as const }
    : { valid: false as const, message: `직원 불가 일정과 겹칩니다: ${conflicts.join(", ")}` };
}
