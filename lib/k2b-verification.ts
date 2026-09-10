export type K2BVerificationState = "GREEN" | "YELLOW" | "RED" | "UNVERIFIED" | "STALE";

export type K2BVerificationTarget = {
  journalId?: number | null;
  code: string;
  /** DB canonical: 산재관리번호 + 개시번호가 모두 있어야 자동 연계한다. */
  industrialAccidentNumber?: string | null;
  commencementNumber?: string | null;
  businessName: string;
  resultDate: string;
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
};

export type K2BVerificationVerdict = "정상" | "오류" | "날짜 불일치" | "내부 전송일자 없음" | "미접수" | "확인 필요";

export type K2BReconciliation = {
  target: K2BVerificationTarget;
  match: K2BSubmissionResult | null;
  matchMethod: "exact_keys" | "AMBIGUOUS" | "NONE" | "MISSING_KEY";
  state: K2BVerificationState;
  verdict: K2BVerificationVerdict;
};

const normalizeKey = (value: unknown) => String(value ?? "").replace(/\D/g, "");

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
    return candidates[0];
  }
  return null;
}

export function reconcileK2BSubmissionResults(targets: K2BVerificationTarget[], results: K2BSubmissionResult[], read?: { completeness: "COMPLETE" | "INCOMPLETE" | "UNKNOWN" }): K2BReconciliation[] {
  const candidates = targets.map((target) => {
    const management = normalizeKey(target.industrialAccidentNumber);
    const commencement = normalizeKey(target.commencementNumber);
    if (!management || !commencement) return { target, match: null, matchMethod: "MISSING_KEY" as const };
    const exact = results.filter((row) => normalizeKey(row.managementNumber) === management && normalizeKey(row.commencementNumber) === commencement);
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

export function statusToState(status: string | null | undefined, target?: Pick<K2BVerificationTarget, "internalK2BStatus" | "internalK2BSendDate" | "resultDate">, hasActualError = false): K2BVerificationState {
  const actual = String(status ?? "").trim();
  const internal = String(target?.internalK2BStatus ?? "").trim();
  const hasExactInternalDate = Boolean(target?.internalK2BSendDate) && target?.internalK2BSendDate === target?.resultDate;
  const internalIsNormal = NORMAL_K2B_STATUS.test(internal);
  // 업무 판정에서 정상은 오직 "정상처리 + 실제 오류내용 없음"이다. 그 밖의 실제
  // 상태는 내부 날짜/상태와 관계없이 오류 관측으로 표시한다.
  if (!actual || !NORMAL_K2B_STATUS.test(actual) || hasActualError) return "RED";
  if (NORMAL_K2B_STATUS.test(actual) && internalIsNormal && hasExactInternalDate) return "GREEN";
  return "YELLOW";
}

export function verificationFailureState(previous: K2BVerificationState | null | undefined): "STALE" | "UNVERIFIED" {
  return previous === "GREEN" ? "STALE" : "UNVERIFIED";
}
