import { hasK2BReceiptError, type K2BSubmissionResult } from "../k2b-verification";

export type K2BCalendarSyncDecision =
  | { shouldSync: true; period: "first" | "second" }
  | { shouldSync: false; reason: "not_exact" | "not_normal" | "unsupported_period" };

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
  if (input.measurementPeriod === "상반기") return { shouldSync: true, period: "first" };
  if (input.measurementPeriod === "하반기") return { shouldSync: true, period: "second" };
  return { shouldSync: false, reason: "unsupported_period" };
}
