export const DOCUMENT_GENERATION_POLL_INTERVAL_MS = 3000;

export const DOCUMENT_GENERATION_STATUS_LABELS: Record<string, string> = {
  NOT_REQUESTED: "문서 생성",
  PENDING: "문서 생성 중",
  PROCESSING: "문서 생성 중",
  COMPLETED: "문서 재생성",
  PARTIAL_SUCCESS: "다시 생성",
  FAILED: "다시 생성",
};

export function isDocumentGenerationRunning(status: string) {
  return status === "PENDING" || status === "PROCESSING";
}

export function documentGenerationPollDelay(status: string) {
  return isDocumentGenerationRunning(status) ? DOCUMENT_GENERATION_POLL_INTERVAL_MS : null;
}

export function shouldApplyDocumentGenerationResponse(
  responseSequence: number,
  latestSequence: number
) {
  return responseSequence === latestSequence;
}
