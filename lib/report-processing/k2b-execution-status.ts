type JsonRecord = Record<string, unknown>;

type K2BJobRow = {
  id: string;
  status: string | null;
  error_message: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  execution_result: unknown;
};

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

const asString = (value: unknown): string | null => typeof value === "string" ? value : null;
const asNumber = (value: unknown): number | null => typeof value === "number" ? value : null;
const asBoolean = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;
const asStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
const asArray = (value: unknown): unknown[] | null => Array.isArray(value) ? value : null;

function persistedCounts(value: unknown) {
  const counts = asRecord(value);
  if (!counts) return null;
  return {
    attempted: asNumber(counts.attempted),
    saved: asNumber(counts.saved),
    failed: asNumber(counts.failed),
    insertedCount: asNumber(counts.insertedCount),
    updatedCount: asNumber(counts.updatedCount),
    unchangedCount: asNumber(counts.unchangedCount),
    fallbackKeyCount: asNumber(counts.fallbackKeyCount),
    matched: asNumber(counts.matched),
  };
}

/** execution_result에 실제 저장된 K2B 원본 동기화 관측값만 API 계약으로 노출한다. */
export function toK2BExecutionStatus(job: K2BJobRow) {
  const result = asRecord(job.execution_result);
  const createdAt = typeof job.created_at === "string" ? Date.parse(job.created_at) : NaN;
  const startedAt = typeof job.started_at === "string" ? Date.parse(job.started_at) : NaN;

  return {
    runId: job.id,
    requestedAt: job.created_at,
    queueStatus: job.status,
    workerStartedAt: job.started_at,
    workerFinishedAt: job.finished_at,
    queueWaitMs: Number.isFinite(createdAt) && Number.isFinite(startedAt) ? Math.max(0, startedAt - createdAt) : null,
    trigger: asString(result?.trigger),
    serializationDisposition: asString(result?.serializationDisposition),
    fromDate: asString(result?.fromDate),
    toDate: asString(result?.toDate),
    requestedRange: asRecord(result?.requestedRange),
    queriedRange: asRecord(result?.queriedRange),
    sourceHost: asString(result?.sourceHost),
    host: asString(result?.host),
    queriedDates: asStringArray(result?.queriedDates),
    dateResults: asArray(result?.dateResults),
    remoteK2BReadAttempted: asBoolean(result?.remoteK2BReadAttempted),
    remoteK2BReadExecuted: asBoolean(result?.remoteK2BReadExecuted),
    remoteReadState: asString(result?.remoteReadState),
    remoteRowCount: asNumber(result?.remoteRowCount),
    candidateCounts: asRecord(result?.candidateCounts),
    matchCounts: asRecord(result?.matchCounts),
    persistence: asRecord(result?.persistence),
    rawReceiptPersistence: persistedCounts(result?.rawReceiptPersistence),
    journalVerification: persistedCounts(result?.journalVerification),
    databaseSaveCompleted: asBoolean(result?.databaseSaveCompleted),
    cursorBefore: asString(result?.cursorBefore),
    cursorAfter: asString(result?.cursorAfter),
    cursorAdvanced: asBoolean(result?.cursorAdvanced),
    cursorEligible: asBoolean(result?.cursorEligible),
    failureStage: asString(result?.failureStage),
    uploadExecuted: asBoolean(result?.uploadExecuted),
    lastError: job.error_message,
  };
}
