import type { Coordinate } from "./types";

export const PUBLIC_SAMPLE_CODE_BY_NAME = {
  "이태환": "A",
  "한기문": "B",
  "강종구": "C",
  "이주형": "D",
  "고유빈": "F",
  "김민영": "G",
} as const;

export interface MeasurementAssigneeUser {
  id: number;
  name: string;
  active?: boolean;
}

export interface MeasurementAssignmentTarget {
  targetId: number;
  measurementDate: string;
  address: string | null;
  coordinate: Coordinate | null;
}

export interface ExistingMeasurementAssignment extends MeasurementAssignmentTarget {
  userId: number;
}

export interface MeasurementAssignmentResult {
  targetId: number;
  userId: number;
  userName: string;
  publicSampleCode: string;
  dailyCount: number;
  approvalRequired: boolean;
  reason: "측정자 균등배정" | "동일주소 묶음" | "근거리 묶음" | "2건 배정" | "3건 승인 필요";
}

function normalizedAddress(value: string | null) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function distanceKm(left: Coordinate | null, right: Coordinate | null) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const radians = (value: number) => value * Math.PI / 180;
  const lat = radians(right.latitude - left.latitude);
  const lng = radians(right.longitude - left.longitude);
  const value = Math.sin(lat / 2) ** 2 +
    Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/**
 * 예비조사자·실측정자·보고서 담당자와 무관하게 측정자(공시료 담당자)를 배정한다.
 * 하루에 6명이 한 번씩 배정되기 전에는 중복하지 않고, 이후에는
 * 동일주소 > 근거리 > 현재 배정수 순으로 최대 2건까지 자동 배정한다.
 */
export function assignMeasurementAssignees(input: {
  targets: MeasurementAssignmentTarget[];
  users: MeasurementAssigneeUser[];
  existing?: ExistingMeasurementAssignment[];
}): MeasurementAssignmentResult[] {
  const users = input.users
    .filter((user) => user.active !== false && user.name in PUBLIC_SAMPLE_CODE_BY_NAME)
    .sort((left, right) => PUBLIC_SAMPLE_CODE_BY_NAME[left.name as keyof typeof PUBLIC_SAMPLE_CODE_BY_NAME]
      .localeCompare(PUBLIC_SAMPLE_CODE_BY_NAME[right.name as keyof typeof PUBLIC_SAMPLE_CODE_BY_NAME]));
  if (!users.length) return [];

  const assigned: ExistingMeasurementAssignment[] = [...(input.existing ?? [])];
  const results: MeasurementAssignmentResult[] = [];
  const targets = [...input.targets].sort((left, right) =>
    left.measurementDate.localeCompare(right.measurementDate) || left.targetId - right.targetId,
  );

  for (const target of targets) {
    const sameDate = assigned.filter((item) => item.measurementDate === target.measurementDate);
    const count = (userId: number) => sameDate.filter((item) => item.userId === userId).length;
    const unassigned = users.filter((user) => count(user.id) === 0);
    let candidates = unassigned.length ? unassigned : users.filter((user) => count(user.id) < 2);
    if (!candidates.length) candidates = users;

    const exactAddressUsers = new Set(sameDate
      .filter((item) => normalizedAddress(item.address) && normalizedAddress(item.address) === normalizedAddress(target.address))
      .map((item) => item.userId));
    const closestDistance = (userId: number) => Math.min(
      ...sameDate.filter((item) => item.userId === userId).map((item) => distanceKm(item.coordinate, target.coordinate)),
      Number.POSITIVE_INFINITY,
    );
    candidates.sort((left, right) =>
      Number(!exactAddressUsers.has(left.id)) - Number(!exactAddressUsers.has(right.id)) ||
      closestDistance(left.id) - closestDistance(right.id) ||
      count(left.id) - count(right.id) || left.id - right.id,
    );
    const selected = candidates[0];
    const nextCount = count(selected.id) + 1;
    const exactAddress = exactAddressUsers.has(selected.id);
    const close = Number.isFinite(closestDistance(selected.id));
    const approvalRequired = nextCount >= 3;
    const reason: MeasurementAssignmentResult["reason"] = approvalRequired
      ? "3건 승인 필요"
      : exactAddress ? "동일주소 묶음"
        : close && nextCount > 1 ? "근거리 묶음"
          : nextCount > 1 ? "2건 배정" : "측정자 균등배정";
    assigned.push({ ...target, userId: selected.id });
    results.push({
      targetId: target.targetId,
      userId: selected.id,
      userName: selected.name,
      publicSampleCode: PUBLIC_SAMPLE_CODE_BY_NAME[selected.name as keyof typeof PUBLIC_SAMPLE_CODE_BY_NAME],
      dailyCount: nextCount,
      approvalRequired,
      reason,
    });
  }
  return results;
}
