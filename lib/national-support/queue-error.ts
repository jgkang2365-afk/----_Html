export const NATIONAL_SUPPORT_SYNC_STATUSES = [
  "정보부족",
  "조회대기",
  "조회중",
  "확인대기",
  "신청중",
  "신청완료대기",
  "비대상대기",
  "수동확인필요",
  "성공",
  "실패",
  "대기",
] as const;

type DatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type NationalSupportQueueErrorCode =
  | "NATIONAL_SUPPORT_ALREADY_RUNNING"
  | "NATIONAL_SUPPORT_TARGET_NOT_FOUND"
  | "NATIONAL_SUPPORT_SYNC_STATUS_CONSTRAINT"
  | "NATIONAL_SUPPORT_QUEUE_MIGRATION_REQUIRED"
  | "NATIONAL_SUPPORT_LOCK_UPDATE_FAILED";

export function classifyNationalSupportQueueError(
  error: DatabaseError,
): NationalSupportQueueErrorCode {
  const message = error.message || "";
  if (
    error.code === "P0001" &&
    (message.includes("ALREADY_RUNNING") || message.includes("JOB_DUPLICATE"))
  ) {
    return "NATIONAL_SUPPORT_ALREADY_RUNNING";
  }
  if (error.code === "P0002" || message.includes("TARGET_NOT_FOUND")) {
    return "NATIONAL_SUPPORT_TARGET_NOT_FOUND";
  }
  if (error.code === "23514") {
    return "NATIONAL_SUPPORT_SYNC_STATUS_CONSTRAINT";
  }
  if (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    message.includes("enqueue_national_support_job")
  ) {
    return "NATIONAL_SUPPORT_QUEUE_MIGRATION_REQUIRED";
  }
  return "NATIONAL_SUPPORT_LOCK_UPDATE_FAILED";
}

export function isAllowedNationalSupportSyncStatus(value: unknown) {
  return value === null || NATIONAL_SUPPORT_SYNC_STATUSES.includes(value as never);
}
