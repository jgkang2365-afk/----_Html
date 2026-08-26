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
  const measurementConflict = input.measurementScheduleBlocked || input.measurementRoleScheduleBlocked;

  if (input.trueConfirmed) {
    return {
      status: "true_confirmed",
      conflict: input.preliminaryScheduleBlocked
        ? "찐확정 계획에 예비조사자 직원 불가 일정 충돌"
        : measurementConflict ? "찐확정 계획에 직원 제외 일정 충돌" : null,
    };
  }

  const status: StoredPlanWorkbenchStatus = input.preliminaryScheduleBlocked
    ? "review_required"
    : input.stale || input.planOrigin === "automatic"
      ? "review_required"
      : input.planStatus === "manual_required"
        ? "adjustment_required"
        : input.hasPlan ? "provisional" : "unassigned";
  const conflict = input.preliminaryScheduleBlocked
    ? "예비조사자 직원 불가 일정 · 재추천 필요"
    : input.stale
      ? "측정계획 영향값 변경"
      : measurementConflict
        ? "직원 제외 일정 참고"
        : input.planStatus === "manual_required" ? "조정 필요" : null;

  return { status, conflict };
}
