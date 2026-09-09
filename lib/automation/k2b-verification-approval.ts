type StoredVerificationRow = {
  journalId?: unknown;
  verdict?: unknown;
  actualStatus?: unknown;
  actualSubmissionDate?: unknown;
  errorViewAvailable?: unknown;
};

export type ApprovedK2BVerificationRow = {
  journalId: number;
  actualStatus: string;
  actualSubmissionDate: string;
};

/** 클라이언트 값 대신 성공한 worker job에 저장된 승인 가능 관측값만 선택한다. */
export function selectStoredK2BVerificationApprovalRows(
  executionResult: unknown,
  journalIds: unknown,
): ApprovedK2BVerificationRow[] | null {
  if (!Array.isArray(journalIds) || journalIds.length === 0 || journalIds.length > 100
    || !journalIds.every((id) => Number.isSafeInteger(id) && id > 0)) return null;

  const result = executionResult && typeof executionResult === "object" && !Array.isArray(executionResult)
    ? executionResult as { verificationRows?: unknown }
    : null;
  const rows = Array.isArray(result?.verificationRows) ? result.verificationRows as StoredVerificationRow[] : [];
  const storedByJournalId = new Map(rows
    .filter((row) => Number.isSafeInteger(row.journalId) && Number(row.journalId) > 0)
    .map((row) => [Number(row.journalId), row]));
  const selected = [...new Set(journalIds as number[])].map((journalId) => ({ journalId, row: storedByJournalId.get(journalId) }));

  if (selected.some(({ row }) => !row
    || !["날짜 불일치", "내부 전송일자 없음"].includes(String(row.verdict))
    || row.errorViewAvailable === true
    || typeof row.actualStatus !== "string" || !row.actualStatus.trim()
    || typeof row.actualSubmissionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.actualSubmissionDate))) return null;

  return selected.map(({ journalId, row }) => ({
    journalId,
    actualStatus: row!.actualStatus as string,
    actualSubmissionDate: row!.actualSubmissionDate as string,
  }));
}
