export type StoredPlanWorkbenchStatus =
  | "true_confirmed"
  | "review_required"
  | "adjustment_required"
  | "provisional"
  | "unassigned";

export function storedPlanWorkbenchState(input: {
  trueConfirmed: boolean;
  stale: boolean;
  hasPlan: boolean;
  planOrigin: string | null;
  planStatus: string | null;
  preliminaryScheduleBlocked: boolean;
  measurementScheduleBlocked: boolean;
  measurementRoleScheduleBlocked: boolean;
}): { status: StoredPlanWorkbenchStatus; conflict: string | null } {
  const scheduleConflict = input.preliminaryScheduleBlocked ||
    input.measurementScheduleBlocked || input.measurementRoleScheduleBlocked;
  const status: StoredPlanWorkbenchStatus = input.trueConfirmed
    ? "true_confirmed"
    : input.stale || scheduleConflict || input.planOrigin === "automatic"
      ? "review_required"
      : input.planStatus === "manual_required"
        ? "adjustment_required"
        : input.hasPlan ? "provisional" : "unassigned";
  const conflict = input.trueConfirmed && scheduleConflict
    ? "찐확정 계획에 직원 제외 일정 충돌"
    : input.stale
      ? "측정계획 영향값 변경"
      : scheduleConflict
        ? "직원 제외 일정 추가 · 재검토 필요"
        : input.planStatus === "manual_required" ? "조정 필요" : null;
  return { status, conflict };
}
