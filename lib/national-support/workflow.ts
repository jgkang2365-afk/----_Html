export type PortalLookupResult = "SUPPORT" | "NON_SUPPORT" | "STANDBY" | "NO_RESULT" | "FAIL";
export type ApplicationResult =
  | "APPLIED"
  | "OVER_50"
  | "NO_EMPLOYEE_INFO"
  | "EMPLOYEE_CHECK_FAILED"
  | "YEAR_CHECK_REQUIRED"
  | "APPLY_RESULT_UNKNOWN"
  | "ALREADY_APPLIED"
  | "FAIL";
export type NationalSupportMode = "lookup_only" | "apply_if_missing" | "final_lookup";

export const FINAL_LOOKUP_MAX_ATTEMPTS = 3;
export const FINAL_LOOKUP_DELAY_MS = 60_000;

export function shouldApplyAfterLookup(result: PortalLookupResult) {
  return result === "NO_RESULT";
}

export function shouldRetryFinalLookup(result: PortalLookupResult, attemptCount: number) {
  return (
    (result === "STANDBY" || result === "NO_RESULT") &&
    attemptCount < FINAL_LOOKUP_MAX_ATTEMPTS
  );
}

export function decideLookupAction(
  mode: NationalSupportMode,
  result: PortalLookupResult,
  attemptCount = 0,
) {
  if (result === "SUPPORT") return "final_support";
  if (result === "NON_SUPPORT") return "final_non_support";
  if (result === "FAIL") return "fail";
  if (mode === "apply_if_missing") return result === "NO_RESULT" ? "apply" : "wait";
  if (mode === "final_lookup") {
    return shouldRetryFinalLookup(result, attemptCount) ? "retry" : "manual";
  }
  return "wait";
}

export function activeNationalSupportJobKey(
  targetId: string | number,
  mode: NationalSupportMode,
) {
  return `${targetId}:national_support:${mode}`;
}

export function isFinalNationalSupportStatus(value: unknown): value is "대상" | "비대상" {
  return value === "대상" || value === "비대상";
}

export function preserveFinalNationalSupportStatus(...values: unknown[]) {
  return values.find(isFinalNationalSupportStatus) ?? null;
}
