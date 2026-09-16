/**
 * K2B attachment execution and the later receipt-grid confirmation are separate
 * facts. Keep them explicit so an old Grid row or a reader failure cannot turn
 * an attachment attempt into a final success.
 */
export type K2BPostUploadResult = {
  code: unknown;
  companyName: string;
  year: unknown;
  period: unknown;
  uploadSucceeded: boolean;
  gridConfirmedNormal: boolean;
  success: boolean;
  uploadStatus?: string;
  status?: string;
  error?: string;
  failureStage?: string;
  calendarSyncSuccess?: boolean;
  calendarSyncError?: string;
};

export function beginK2BPostUploadResult(input: {
  code: unknown;
  companyName: string;
  year: unknown;
  period: unknown;
  uploadSucceeded: boolean;
  uploadStatus?: string;
  error?: string;
  failureStage?: string;
}): K2BPostUploadResult {
  return {
    code: input.code,
    companyName: input.companyName,
    year: input.year,
    period: input.period,
    uploadSucceeded: input.uploadSucceeded,
    gridConfirmedNormal: false,
    // uploadReport success alone must never enter final success aggregation.
    success: false,
    uploadStatus: input.uploadStatus,
    status: input.uploadSucceeded ? '결과 확인 필요' : input.uploadStatus,
    error: input.error,
    failureStage: input.failureStage,
  };
}

export function finalizeK2BPostUploadResult(
  result: K2BPostUploadResult,
  input: {
    gridComplete: boolean;
    exactCanonicalMatch: boolean;
    latestNormal: boolean;
    status?: string;
    error?: string;
  },
): K2BPostUploadResult {
  const gridConfirmedNormal = result.uploadSucceeded
    && input.gridComplete
    && input.exactCanonicalMatch
    && input.latestNormal;

  return {
    ...result,
    gridConfirmedNormal,
    success: gridConfirmedNormal,
    status: input.status ?? result.status,
    error: gridConfirmedNormal ? undefined : input.error ?? result.error,
  };
}

export function markK2BGridConfirmationFailure(
  result: K2BPostUploadResult,
  error: string,
): K2BPostUploadResult {
  if (!result.uploadSucceeded) return result;

  return {
    ...result,
    gridConfirmedNormal: false,
    success: false,
    status: '결과 확인 필요',
    error,
    failureStage: 'grid-confirmation',
  };
}
