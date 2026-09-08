export type K2BVerificationState = "GREEN" | "YELLOW" | "RED" | "UNVERIFIED" | "STALE";

export type K2BVerificationTarget = {
  code: string;
  businessNumber?: string | null;
  businessName: string;
  resultDate: string;
  previousVerifiedStatus?: K2BVerificationState | null;
  previousVerifiedAt?: string | null;
  internalK2BStatus?: string | null;
  internalK2BSendDate?: string | null;
};

export type K2BSubmissionResult = {
  businessNumber?: string | null;
  companyName?: string | null;
  submissionDate?: string | null;
  status?: string | null;
};

export type K2BReconciliation = {
  target: K2BVerificationTarget;
  match: K2BSubmissionResult | null;
  matchMethod: "business_number" | "name_and_date" | "AMBIGUOUS" | "NONE";
  state: K2BVerificationState;
};

const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/[^0-9A-Za-z가-힣]/g, "").toLowerCase();

const NORMAL_K2B_STATUS = /^(정상처리|접수완료|업로드 완료)$/;
const FAILED_K2B_STATUS = /(반려|실패|오류|미접수|not[ _-]?found)/i;

function hasExactResultDate(target: K2BVerificationTarget, row: K2BSubmissionResult): boolean {
  // K2B 화면 조회일과 실제 행의 접수일은 항상 같아야 한다.
  // 내부 전송일이 있으면 그 날짜도 같아야 하지만, 직원 수동 처리처럼 비어 있으면
  // 이후의 단일 정확 매칭을 YELLOW(확인필요)로만 기록한다.
  return row.submissionDate === target.resultDate
    && (!target.internalK2BSendDate || target.internalK2BSendDate === target.resultDate);
}

function singleMatch(candidates: K2BSubmissionResult[]): K2BSubmissionResult | null {
  return candidates.length === 1 ? candidates[0] : null;
}

export function reconcileK2BSubmissionResults(targets: K2BVerificationTarget[], results: K2BSubmissionResult[]): K2BReconciliation[] {
  const candidates = targets.map((target) => {
    const datedResults = results.filter((row) => hasExactResultDate(target, row));
    const byBusinessNumber = datedResults.filter((row) => normalize(row.businessNumber) === normalize(target.businessNumber) && normalize(target.businessNumber));
    const businessNumber = singleMatch(byBusinessNumber);
    if (businessNumber) return { target, match: businessNumber, matchMethod: "business_number" as const };
    if (byBusinessNumber.length > 1) return { target, match: null, matchMethod: "AMBIGUOUS" as const };

    const byNameAndDate = datedResults.filter((row) => normalize(row.companyName) === normalize(target.businessName) && normalize(target.businessName));
    const nameAndDate = singleMatch(byNameAndDate);
    if (nameAndDate) return { target, match: nameAndDate, matchMethod: "name_and_date" as const };
    if (byNameAndDate.length > 1) return { target, match: null, matchMethod: "AMBIGUOUS" as const };

    // 최초 미발견은 외부 조회 실패와 구별해 재확인 대상(YELLOW)으로 보존한다.
    return { target, match: null, matchMethod: "NONE" as const };
  });

  return candidates.map((candidate) => {
    // 하나의 K2B 행이 둘 이상의 내부 후보에 정확히 맞으면 어느 일지에도 자동 연결하지 않는다.
    if (candidate.match && candidates.filter((other) => other.match === candidate.match).length > 1) {
      return { target: candidate.target, match: null, matchMethod: "AMBIGUOUS" as const, state: "YELLOW" as const };
    }
    if (!candidate.match) {
      return { target: candidate.target, match: null, matchMethod: candidate.matchMethod, state: "YELLOW" as const };
    }
    return {
      target: candidate.target,
      match: candidate.match,
      matchMethod: candidate.matchMethod,
      state: statusToState(candidate.match.status, candidate.target),
    };
  });
}

export function statusToState(status: string | null | undefined, target?: Pick<K2BVerificationTarget, "internalK2BStatus" | "internalK2BSendDate" | "resultDate">): K2BVerificationState {
  const actual = String(status ?? "").trim();
  const internal = String(target?.internalK2BStatus ?? "").trim();
  const hasExactInternalDate = Boolean(target?.internalK2BSendDate)
    && target?.internalK2BSendDate === target?.resultDate;
  const internalIsNormal = NORMAL_K2B_STATUS.test(internal);
  if (!actual || FAILED_K2B_STATUS.test(actual)) {
    return internalIsNormal && hasExactInternalDate ? "RED" : "YELLOW";
  }
  if (NORMAL_K2B_STATUS.test(actual) && internalIsNormal && hasExactInternalDate) return "GREEN";
  return "YELLOW";
}

export function verificationFailureState(previous: K2BVerificationState | null | undefined): "STALE" | "UNVERIFIED" {
  return previous === "GREEN" ? "STALE" : "UNVERIFIED";
}
