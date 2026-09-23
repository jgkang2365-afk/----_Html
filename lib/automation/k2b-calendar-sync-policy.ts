import { hasK2BReceiptError, type K2BSubmissionResult } from "../k2b-verification";

export type K2BCalendarSyncDecision =
  | { shouldSync: true; period: "first" | "second" }
  | { shouldSync: false; reason: "not_exact" | "not_normal" | "unsupported_period" };

export function resolveK2BCalendarPeriod(
  measurementPeriod: string | null | undefined,
): "first" | "second" | null {
  if (measurementPeriod === "상반기") return "first";
  if (measurementPeriod === "하반기") return "second";
  return null;
}

/** Only a real K2B send-date transition can change calendar completion state. */
export function shouldSyncK2BCalendarForJournalChange(
  current: { k2b_send_date?: string | null } | null | undefined,
  update: Record<string, unknown> | null | undefined,
): boolean {
  if (!update || !Object.prototype.hasOwnProperty.call(update, "k2b_send_date")) return false;
  return (current?.k2b_send_date ?? null) !== (update.k2b_send_date ?? null);
}

/** Manual actual-result verification also acts as an explicit calendar reconciliation request. */
export function shouldForceManualK2BCalendarRepair(input: {
  trigger: string | null | undefined;
  matchMethod: string | null | undefined;
  verdict: string | null | undefined;
}): boolean {
  return input.trigger === "manual"
    && input.matchMethod === "exact_keys"
    && ["정상", "사용자반송", "오류"].includes(String(input.verdict ?? ""));
}

/** The scheduled repair is limited to confirmed canonical rows from the existing K2B read. */
export function shouldForceScheduledK2BCalendarRepair(input: {
  trigger: string | null | undefined;
  matchMethod: string | null | undefined;
  verdict: string | null | undefined;
}): boolean {
  return input.trigger === "scheduled"
    && input.matchMethod === "exact_keys"
    && ["정상", "사용자반송", "오류"].includes(String(input.verdict ?? ""));
}

/**
 * 캘린더는 canonical exact match인 최종 정상 K2B 결과만 동기화한다.
 * 이 결정은 업로드 results 배열과 독립적이라, 결과 표시용 배열 누락이 동기화를 막지 않는다.
 */
export function decideK2BCalendarSync(input: {
  exactMatch: boolean;
  receipt: Pick<K2BSubmissionResult, "status" | "errorViewAvailable" | "errorDetail"> | null | undefined;
  measurementPeriod: string | null | undefined;
}): K2BCalendarSyncDecision {
  if (!input.exactMatch) return { shouldSync: false, reason: "not_exact" };
  if (!input.receipt || String(input.receipt.status ?? "").trim() !== "정상처리" || hasK2BReceiptError(input.receipt)) {
    return { shouldSync: false, reason: "not_normal" };
  }
  const period = resolveK2BCalendarPeriod(input.measurementPeriod);
  return period
    ? { shouldSync: true, period }
    : { shouldSync: false, reason: "unsupported_period" };
}
