export type NationalSupportTargetState = {
  id: number | string;
  code: string;
  year: number;
  period: string;
  sync_status?: string | null;
  national_support_status: string | null;
  sync_error_message?: string | null;
};

/** Terminal projection은 동일 사업장의 국고 상태 세 필드만 갱신한다. */
export function mergeNationalSupportTargetState<T extends Partial<NationalSupportTargetState>>(
  current: T,
  target: Pick<NationalSupportTargetState, "id" | "code" | "year" | "period">,
  state: NationalSupportTargetState,
): T {
  if (String(current.id) !== String(target.id) || String(state.id) !== String(target.id) ||
      current.code !== target.code || state.code !== target.code ||
      current.year !== target.year || state.year !== target.year ||
      current.period !== target.period || state.period !== target.period) return current;
  if (current.sync_status === state.sync_status &&
      current.national_support_status === state.national_support_status &&
      current.sync_error_message === state.sync_error_message) return current;
  return { ...current, sync_status: state.sync_status,
    national_support_status: state.national_support_status,
    sync_error_message: state.sync_error_message };
}
