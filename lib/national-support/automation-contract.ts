import type { SupabaseClient } from "@supabase/supabase-js";

export const NATIONAL_SUPPORT_RESULT_CODES = [
  "SUPPORT", "NON_SUPPORT", "OVER_50_RECHECK", "NO_EMPLOYEE_INFO_RECHECK",
  "EMPLOYEE_CHECK_FAILED_RECHECK", "JOURNAL_REGISTERED_SKIP",
  "APPLIED_WAITING_RESULT", "ALREADY_APPLIED", "APPLICATION_UNCERTAIN",
] as const;

export type NationalSupportResultCode = (typeof NATIONAL_SUPPORT_RESULT_CODES)[number];
export type NationalSupportCompatibilityStatus =
  | "성공" | "비대상대기" | "확인대기" | "신청완료대기" | "수동확인필요" | "실패";

export function nationalSupportCompatibilityStatus(code: NationalSupportResultCode): NationalSupportCompatibilityStatus {
  switch (code) {
    case "SUPPORT":
    case "NON_SUPPORT":
    case "JOURNAL_REGISTERED_SKIP": return "성공";
    case "OVER_50_RECHECK":
    case "NO_EMPLOYEE_INFO_RECHECK":
    case "EMPLOYEE_CHECK_FAILED_RECHECK": return "비대상대기";
    case "APPLIED_WAITING_RESULT": return "신청완료대기";
    case "ALREADY_APPLIED": return "확인대기";
    case "APPLICATION_UNCERTAIN": return "수동확인필요";
  }
}

/** Production canonical mapping: target(year/period) -> journal(measurement_year/measurement_period). */
export async function hasMeasurementJournalForTarget(
  supabase: SupabaseClient<any>,
  target: { code: string; year: number | string; period: string },
) {
  const { data, error } = await supabase.from("measurement_journal").select("id")
    .eq("code", target.code).eq("measurement_year", Number(target.year))
    .eq("measurement_period", target.period).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}
