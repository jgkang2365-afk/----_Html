export const NATIONAL_SUPPORT_TARGET_KEY_MISMATCH = "NATIONAL_SUPPORT_TARGET_KEY_MISMATCH";

export function matchesNationalSupportTargetKey(
  requested: { code: unknown; year: unknown; period: unknown },
  canonical: { code: unknown; year: unknown; period: unknown },
) {
  return String(requested.code) === String(canonical.code) &&
    Number.isFinite(Number(requested.year)) &&
    Number(requested.year) === Number(canonical.year) &&
    String(requested.period) === String(canonical.period);
}

export function nationalSupportApplyOutcome(response: { resultCode?: string; instantSync?: boolean }) {
  if (["JOURNAL_REGISTERED_SKIP", "TARGET_STATUS_SKIP", "REPRESENTATIVE_REVIEW_SKIP", "APPLICATION_INFO_CHANGED_SKIP"].includes(response.resultCode || "")) return "excluded" as const;
  return response.instantSync ? "instant" as const : "queued" as const;
}
