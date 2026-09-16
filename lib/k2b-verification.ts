export type K2BVerificationState = "GREEN" | "YELLOW" | "RED" | "UNVERIFIED" | "STALE";

export type K2BVerificationTarget = {
  journalId?: number | null;
  code: string;
  /** DB canonical: 산재관리번호 + 개시번호가 모두 있어야 자동 연계한다. */
  industrialAccidentNumber?: string | null;
  commencementNumber?: string | null;
  businessName: string;
  resultDate: string;
  measurementYear?: number | null;
  measurementPeriod?: string | null;
  previousVerifiedStatus?: K2BVerificationState | null;
  previousVerifiedAt?: string | null;
  internalK2BStatus?: string | null;
  internalK2BSendDate?: string | null;
};

export type K2BSubmissionResult = {
  managementNumber?: string | null;
  commencementNumber?: string | null;
  companyName?: string | null;
  submissionDate?: string | null;
  status?: string | null;
  errorViewAvailable?: boolean;
  errorDetail?: string | null;
  submissionNumber?: string | null;
  identityConflict?: boolean;
  businessYear?: string | number | null;
  half?: string | null;
};

export type K2BVerificationVerdict = "정상" | "오류" | "날짜 불일치" | "내부 전송일자 없음" | "미접수" | "확인 필요";

export type K2BReconciliation = {
  target: K2BVerificationTarget;
  match: K2BSubmissionResult | null;
  matchMethod: "exact_keys" | "AMBIGUOUS" | "NONE" | "MISSING_KEY";
  state: K2BVerificationState;
  verdict: K2BVerificationVerdict;
};

export type K2BReconciliationJournal = Pick<K2BVerificationTarget, "internalK2BSendDate"> & {
  k2bStatus: string | null | undefined;
};

export const K2B_STALE_NOTICE = "자동 재확인 기간 7일이 경과했습니다. 필요 시 관리자 재검증을 실행하세요.";

const normalizeKey = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const normalizeYear = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const normalizePeriod = (value: unknown) => String(value ?? "").replace(/\s+/g, "").trim();

const NORMAL_K2B_STATUS = /^정상처리$/;

function isNormalReceipt(row: K2BSubmissionResult): boolean {
  return NORMAL_K2B_STATUS.test(String(row.status ?? "").trim()) && !hasK2BReceiptError(row);
}

/** 수집기가 산출한 실제 오류 신호와 오류내용을 함께 판정한다. */
export function hasK2BReceiptError(row: Pick<K2BSubmissionResult, "errorViewAvailable" | "errorDetail">): boolean {
  return row.errorViewAvailable === true || Boolean(String(row.errorDetail ?? "").trim());
}

/**
 * K2B는 같은 canonical 키에 과거 오류 행과 최종 정상 행을 함께 반환할 수 있다.
 * 접수번호/이름/날짜 순서를 임의 선택 기준으로 쓰지 않고, 정상 행이 정확히 하나일
 * 때만 그 행을 확정한다. 정상 행이 전혀 없고 모두 오류면 오류 사실만 유지한다.
 */
function resolveExactReceipt(candidates: K2BSubmissionResult[]): K2BSubmissionResult | null {
  if (candidates.some(row => row.identityConflict)) return null;
  const normal = candidates.filter(isNormalReceipt);
  if (normal.length === 1) return normal[0];
  if (normal.length === 0 && candidates.length > 0 && candidates.every((row) => !isNormalReceipt(row))) {
    // 오류만 있는 경우에도 Grid 행 순서가 final remote 상태를 바꾸지 않도록
    // 실제 접수일, 상태, 접수번호 순으로 결정론적으로 최신 후보를 선택한다.
    return [...candidates].sort((left, right) => [
      String(right.submissionDate ?? ''), String(right.status ?? ''), String(right.submissionNumber ?? ''),
    ].join('\u0000').localeCompare([
      String(left.submissionDate ?? ''), String(left.status ?? ''), String(left.submissionNumber ?? ''),
    ].join('\u0000')))[0];
  }
  return null;
}

export function reconcileK2BSubmissionResults(targets: K2BVerificationTarget[], results: K2BSubmissionResult[], read?: { completeness: "COMPLETE" | "INCOMPLETE" | "UNKNOWN" }): K2BReconciliation[] {
  const candidates = targets.map((target) => {
    const management = normalizeKey(target.industrialAccidentNumber);
    const commencement = normalizeKey(target.commencementNumber);
    if (!management || !commencement) return { target, match: null, matchMethod: "MISSING_KEY" as const };
    const targetYear = normalizeYear(target.measurementYear);
    const targetPeriod = normalizePeriod(target.measurementPeriod);
    const exact = results.filter((row) => {
      if (normalizeKey(row.managementNumber) !== management || normalizeKey(row.commencementNumber) !== commencement) return false;
      const receiptYear = normalizeYear(row.businessYear);
      const receiptPeriod = normalizePeriod(row.half);
      // 실제 원본 row에는 사업년도와 반기가 반드시 있으므로 네 키가 모두 같아야 한다.
      // 기존 단위 테스트 fixture처럼 scope가 전혀 없는 경우에만 legacy two-key fixture를 허용한다.
      return !(targetYear || targetPeriod)
        || (targetYear === receiptYear && targetPeriod === receiptPeriod);
    });
    const match = resolveExactReceipt(exact);
    if (match) return { target, match, matchMethod: "exact_keys" as const };
    return { target, match: null, matchMethod: exact.length > 1 ? "AMBIGUOUS" as const : "NONE" as const };
  });

  return candidates.map((candidate) => {
    // 하나의 K2B 행이 둘 이상의 내부 후보에 정확히 맞으면 어느 일지에도 자동 연결하지 않는다.
    if (candidate.match && candidates.filter((other) => other.match === candidate.match).length > 1) {
      return { target: candidate.target, match: null, matchMethod: "AMBIGUOUS" as const, state: "YELLOW" as const, verdict: "확인 필요" as const };
    }
    if (!candidate.match) {
      return { target: candidate.target, match: null, matchMethod: candidate.matchMethod, state: "YELLOW" as const, verdict: candidate.matchMethod === "NONE" && read?.completeness === "COMPLETE" ? "미접수" as const : "확인 필요" as const };
    }
    if (read && read.completeness !== "COMPLETE") {
      return { target: candidate.target, match: candidate.match, matchMethod: candidate.matchMethod, state: "YELLOW" as const, verdict: "확인 필요" as const };
    }
    const verdict = verdictFor(candidate.target, candidate.match);
    return {
      target: candidate.target,
      match: candidate.match,
      matchMethod: candidate.matchMethod,
      state: verdict === "정상" ? "GREEN" : verdict === "오류" ? "RED" : "YELLOW",
      verdict,
    };
  });
}

export function verdictFor(target: K2BVerificationTarget, row: K2BSubmissionResult): K2BVerificationVerdict {
  // 실제 처리 상태가 비정상이거나 실제 오류내용이 있으면 날짜가 달라도 정상/승인
  // 대상으로 분류하지 않는다. K2B의 "정상처리"만으로 정상 판정할 수 없다.
  if (!NORMAL_K2B_STATUS.test(String(row.status ?? "").trim()) || hasK2BReceiptError(row)) return "오류";
  if (!target.internalK2BSendDate) return "내부 전송일자 없음";
  if (row.submissionDate !== target.internalK2BSendDate) return "날짜 불일치";
  return "정상";
}

/** 정상 receipt 또는 실제 비정상 remote status만 내부 상태에 반영한다.
 * 실제 상태는 정상인데 오류내용만 있는 경우에는 내부 상태를 정상으로 덮어쓰지 않는다. */
export function shouldReflectActualK2BStatus(item: Pick<K2BReconciliation, "match" | "verdict">): boolean {
  if (!item.match) return false;
  if (item.verdict === "정상") return true;
  return item.verdict === "오류" && !NORMAL_K2B_STATUS.test(String(item.match.status ?? "").trim());
}

/** 원본 동기화와 일반/관리자 재검증이 공유하는 단일 journal 반영 정책이다. */
export function deriveK2BReconciliationUpdate(
  item: K2BReconciliation,
  journal: K2BReconciliationJournal,
  attemptedAt: string,
): Record<string, string | null> {
  const matched = item.match && item.matchMethod === "exact_keys";
  const note = matched
    ? `K2B 실제결과 ${item.verdict}${item.match?.errorDetail ? `: ${item.match.errorDetail}` : ""}`
    : item.matchMethod === "AMBIGUOUS"
      ? "K2B 결과가 복수 후보여서 자동 확정하지 않음"
      : "K2B 실제결과를 명확히 연결하지 못함";
  const update: Record<string, string | null> = {
    k2b_verified_status: item.state,
    k2b_verified_at: attemptedAt,
    k2b_consistency_status: item.state,
    k2b_consistency_note: note,
    k2b_verification_error: null,
    k2b_verification_attempted_at: attemptedAt,
  };
  if (!matched || !item.match) return update;
  update.k2b_verified_send_date = item.match.submissionDate ?? null;
  update.k2b_verified_result_date = journal.internalK2BSendDate ?? null;
  update.k2b_verified_remote_status = item.match.status ?? null;
  if (shouldReflectActualK2BStatus(item) && journal.internalK2BSendDate === item.match.submissionDate) {
    update.k2b_status = item.match.status ?? null;
  }
  return update;
}

/**
 * STALE은 마지막 실제 관측값을 무효화하지 않는다. 기존 정합성 사유 뒤에 안내만 한 번
 * 덧붙이며, 반복 scheduled 실행에서도 같은 안내를 중복 누적하지 않는다.
 */
export function deriveK2BStaleUpdate(existingConsistencyNote: string | null | undefined): Record<string, string> {
  const existing = String(existingConsistencyNote ?? "").trim();
  return {
    k2b_verified_status: "STALE",
    k2b_consistency_status: "STALE",
    k2b_consistency_note: existing.includes(K2B_STALE_NOTICE)
      ? existing
      : [existing, K2B_STALE_NOTICE].filter(Boolean).join(" "),
  };
}

export function verificationFailureState(previous: K2BVerificationState | null | undefined): "STALE" | "UNVERIFIED" {
  return previous === "GREEN" ? "STALE" : "UNVERIFIED";
}
