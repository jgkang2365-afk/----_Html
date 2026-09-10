import { createHash } from "node:crypto";

export const K2B_SYNC_OVERLAP_DAYS = 3;
export type K2BSyncTrigger = "manual" | "scheduled" | "unknown";

export type K2BOriginalReceipt = {
  fileName: string;
  companyName: string;
  actualSubmissionDate: string;
  businessYear: string;
  half: string;
  supportType: string;
  submissionNumber: string;
  managementNumber: string;
  commencementNumber: string;
  sequenceNumber: string;
  status: string;
  errorViewAvailable: boolean;
  errorDetail: string | null;
  raw: Record<string, string>;
  sourceKey: string;
  identityFallback: boolean;
  /** 동일 접수 고유키에서 서로 다른 값이 관측되면 자동 후보 선택을 금지한다. */
  identityConflict?: boolean;
};

export type K2BRange = { fromDate: string; toDate: string };
export type K2BGridReadEvidence = {
  expectedRowCount: number | null;
  collectedUniqueRowCount: number;
  readMethod: "nexacro_dataset" | "virtual_scroll";
  completeness: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
};
export type K2BGridRead = K2BGridReadEvidence & (
  | { outcome: "SUCCESS"; rows: K2BOriginalReceipt[]; headers: string[] }
  | { outcome: "SUCCESS_EMPTY"; rows: []; headers: string[] });

const HEADER_ALIASES: Record<keyof Omit<K2BOriginalReceipt, "raw" | "sourceKey" | "identityFallback" | "identityConflict" | "errorViewAvailable" | "errorDetail">, string[]> = {
  fileName: ["청구 파일명", "파일명", "파일 명"],
  companyName: ["사업장명", "사업장 명", "업체명"],
  actualSubmissionDate: ["접수일", "접수일자", "실제접수일", "제출일", "제출일자"],
  businessYear: ["사업년도", "사업연도", "사업 년도", "대상연도"],
  half: ["반기", "상반기하반기", "측정반기"],
  supportType: ["지원구분", "지원유형", "지원 유형"],
  submissionNumber: ["접수번호", "접수 번호", "제출번호", "파일접수번호"],
  managementNumber: ["산재관리번호", "산재 관리번호", "관리번호", "관리 번호"],
  commencementNumber: ["개시번호", "개시 번호"],
  sequenceNumber: ["순번", "일련번호", "시퀀스번호"],
  status: ["처리상태", "처리 상태", "접수상태", "상태"],
};

function normalized(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

function asKstDate(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const [year, month, day] = date.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  return cursor.getUTCFullYear() === year && cursor.getUTCMonth() === month - 1 && cursor.getUTCDate() === day ? date : null;
}

function subtractDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("K2B_SYNC_INVALID_DATE");
  const [year, month, day] = date.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() - days);
  return cursor.toISOString().slice(0, 10);
}

export function buildK2BSourceKey(receipt: Pick<K2BOriginalReceipt, "submissionNumber" | "actualSubmissionDate" | "fileName" | "managementNumber">): { sourceKey: string; identityFallback: boolean } {
  const submissionNumber = normalized(receipt.submissionNumber);
  if (submissionNumber) return { sourceKey: `k2b:submission:${submissionNumber}`, identityFallback: false };
  if (!normalized(receipt.fileName) || !asKstDate(receipt.actualSubmissionDate) || !normalized(receipt.managementNumber)) {
    throw new Error("K2B_GRID_SCHEMA_MISMATCH:missing_fallback_identity");
  }
  const canonical = [receipt.fileName, receipt.actualSubmissionDate, receipt.managementNumber]
    .map(normalized).join("|");
  if (!canonical.replaceAll("|", "")) throw new Error("K2B_GRID_SCHEMA_MISMATCH:missing_fallback_identity");
  return { sourceKey: `k2b:fallback:${createHash("sha256").update(canonical).digest("hex")}`, identityFallback: true };
}

/** 수동은 명시 range만, scheduled는 cursor+3일 overlap 또는 D-3..D-1 bootstrap만 허용한다. */
export function buildK2BSyncRange(input: {
  trigger: K2BSyncTrigger;
  today: string;
  fromDate?: string | null;
  toDate?: string | null;
  lastSuccessfulThroughDate?: string | null;
}): K2BRange {
  if (input.trigger === "unknown") throw new Error("K2B_SYNC_UNKNOWN_TRIGGER");
  if (input.trigger === "manual") {
    if (!input.fromDate || !input.toDate || !asKstDate(input.fromDate) || !asKstDate(input.toDate) || input.fromDate > input.toDate) {
      throw new Error("K2B_SYNC_MANUAL_RANGE_REQUIRED");
    }
    return { fromDate: input.fromDate, toDate: input.toDate };
  }
  const through = subtractDays(input.today, 1);
  const cursor = input.lastSuccessfulThroughDate;
  // scheduled는 새 cursor 구간(cursor+1..D-1)과 D-3..D-1 overlap의 합집합이다.
  if (cursor && asKstDate(cursor)) return { fromDate: [subtractDays(cursor, -1), subtractDays(input.today, K2B_SYNC_OVERLAP_DAYS)].sort()[0], toDate: through };
  return { fromDate: subtractDays(input.today, 3), toDate: through };
}

export function inclusiveK2BDates(range: K2BRange): string[] {
  if (range.fromDate > range.toDate) throw new Error("K2B_SYNC_INVALID_RANGE");
  const dates: string[] = [];
  for (let date = range.fromDate; date <= range.toDate; date = subtractDays(date, -1)) dates.push(date);
  return dates;
}

/** 일반 재검증은 KST 오늘을 포함한 정확히 7 calendar days를 한 번에 조회한다. */
export function buildGeneralK2BVerificationRange(today: string): K2BRange {
  if (!asKstDate(today)) throw new Error("K2B_VERIFY_INVALID_TODAY");
  return { fromDate: subtractDays(today, 6), toDate: today };
}

/** 관리자 직접 기간은 31 calendar days를 넘길 수 없다. */
export function assertAdminK2BVerificationRange(fromDate: string, toDate: string): K2BRange {
  if (!asKstDate(fromDate) || !asKstDate(toDate) || fromDate > toDate || inclusiveK2BDates({ fromDate, toDate }).length > 31) {
    throw new Error("K2B_VERIFY_ADMIN_RANGE_INVALID_OR_OVER_31");
  }
  return { fromDate, toDate };
}

/** DOM 고정 column index를 믿지 않고 조회 화면의 header text를 기준으로 원본 행을 해석한다. */
export function parseK2BSubmissionGrid(headers: readonly string[], rows: readonly (readonly string[])[], evidence?: K2BGridReadEvidence): K2BGridRead {
  // 행 배열만으로는 전체 수집을 증명할 수 없다. 브라우저의 수집 근거와 개수를 함께 검증한다.
  const read: K2BGridReadEvidence = evidence ? { ...evidence } : {
    expectedRowCount: null, collectedUniqueRowCount: rows.length, readMethod: "virtual_scroll", completeness: "UNKNOWN",
  };
  if (read.expectedRowCount != null && (!Number.isSafeInteger(read.expectedRowCount) || read.expectedRowCount < 0)) {
    read.expectedRowCount = null;
    read.completeness = "UNKNOWN";
  }
  if (read.collectedUniqueRowCount !== rows.length || (read.expectedRowCount != null && read.expectedRowCount !== rows.length)) read.completeness = "INCOMPLETE";
  if (read.expectedRowCount == null && read.completeness === "COMPLETE") read.completeness = "UNKNOWN";
  const indexes = new Map<string, number[]>();
  for (const [index, header] of headers.entries()) {
    const key = normalized(header);
    indexes.set(key, [...(indexes.get(key) ?? []), index]);
  }
  const indexFor = (field: keyof typeof HEADER_ALIASES, required: boolean) => {
    // 별칭은 공백 정규화 뒤 같은 실제 header를 가리킬 수 있다. 이 경우
    // 실제 column 하나를 여러 번 찾은 것이므로 물리 index 기준으로만 중복을 판정한다.
    const matches = [...new Set(HEADER_ALIASES[field].map(normalized).flatMap(alias => indexes.get(alias) ?? []))];
    if (matches.length > 1) throw new Error(`K2B_GRID_SCHEMA_MISMATCH:ambiguous_${field}`);
    if (required && matches.length !== 1) throw new Error(`K2B_GRID_SCHEMA_MISMATCH:missing_${field}`);
    return matches[0] ?? -1;
  };
  const fieldIndexes = Object.fromEntries((Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).map(field => [field, indexFor(field, true)])) as Record<keyof typeof HEADER_ALIASES, number>;
  if (rows.length === 0) return { outcome: "SUCCESS_EMPTY", rows: [], headers: [...headers], ...read };
  const parsed = rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== headers.length) throw new Error('K2B_GRID_SCHEMA_MISMATCH:incomplete_row');
    const raw = Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()]));
    const date = asKstDate(row[fieldIndexes.actualSubmissionDate]);
    const required = (field: keyof typeof fieldIndexes) => String(row[fieldIndexes[field]] ?? "").trim();
    const errorDetail = Object.entries(raw).filter(([header]) => /오류(내용|상세|사유)/.test(normalized(header)))
      .map(([, value]) => value.trim()).filter(Boolean).join('; ');
    const receipt = { fileName: required("fileName"), companyName: required("companyName"), actualSubmissionDate: date ?? "",
      businessYear: required("businessYear"), half: required("half"), supportType: required("supportType"), submissionNumber: required("submissionNumber"),
      managementNumber: required("managementNumber"), commencementNumber: required("commencementNumber"), sequenceNumber: required("sequenceNumber"),
      // 오류보기 버튼/라벨은 모든 정상 행에도 있을 수 있다. 실제 오류값만 관측한다.
      status: required("status"), errorViewAvailable: Boolean(errorDetail), errorDetail: errorDetail || null,
      raw, sourceKey: "", identityFallback: false };
    if (!date || !receipt.fileName || !receipt.companyName || !receipt.businessYear || !receipt.half || !receipt.supportType || !receipt.managementNumber || !receipt.commencementNumber || !receipt.sequenceNumber || !receipt.status) throw new Error(`K2B_GRID_SCHEMA_MISMATCH:invalid_required_row_${rowIndex}`);
    const identity = buildK2BSourceKey(receipt);
    return { ...receipt, ...identity };
  });
  const rowKey = (row: K2BOriginalReceipt) => row.submissionNumber
    ? JSON.stringify(["submission", row.submissionNumber.trim()])
    : JSON.stringify([row.managementNumber.replace(/\D/g, ""), row.commencementNumber.replace(/\D/g, ""), row.sequenceNumber.trim(), row.fileName.trim()]);
  const identities = new Map<string, number>();
  for (const row of parsed) {
    const key = rowKey(row);
    identities.set(key, (identities.get(key) ?? 0) + 1);
  }
  read.collectedUniqueRowCount = identities.size;
  if (identities.size !== parsed.length || (read.expectedRowCount != null && identities.size !== read.expectedRowCount)) read.completeness = "INCOMPLETE";
  // 동일 내용도 원본 identity 중복이다. 행을 보존하고 중복 exact 후보의 자동 선택을 차단한다.
  const receipts = parsed.map(row => identities.get(rowKey(row))! > 1 ? { ...row, identityConflict: true } : row);
  return { outcome: "SUCCESS", rows: receipts, headers: [...headers], ...read };
}
