import type { SupabaseClient } from "@supabase/supabase-js";

export const NATIONAL_SUPPORT_RESULT_CODES = [
  "SUPPORT", "NON_SUPPORT", "OVER_50_RECHECK", "NO_EMPLOYEE_INFO_RECHECK",
  "EMPLOYEE_CHECK_FAILED_RECHECK", "JOURNAL_REGISTERED_SKIP",
  "APPLIED_WAITING_RESULT", "ALREADY_APPLIED", "LOOKUP_NO_RESULT", "APPLICATION_UNCERTAIN",
] as const;

export type NationalSupportResultCode = (typeof NATIONAL_SUPPORT_RESULT_CODES)[number];
export type NationalSupportCompatibilityStatus =
  | "성공" | "일지 등록 · 제외" | "조회대기" | "비대상대기" | "확인대기" | "신청완료대기" | "수동확인필요" | "실패";

export function nationalSupportCompatibilityStatus(code: NationalSupportResultCode): NationalSupportCompatibilityStatus {
  switch (code) {
    case "SUPPORT":
    case "NON_SUPPORT": return "성공";
    case "JOURNAL_REGISTERED_SKIP": return "일지 등록 · 제외";
    case "OVER_50_RECHECK":
    case "NO_EMPLOYEE_INFO_RECHECK":
    case "EMPLOYEE_CHECK_FAILED_RECHECK": return "비대상대기";
    case "APPLIED_WAITING_RESULT": return "신청완료대기";
    case "ALREADY_APPLIED": return "확인대기";
    case "LOOKUP_NO_RESULT": return "조회대기";
    case "APPLICATION_UNCERTAIN": return "수동확인필요";
  }
}

/** The only result-code to legacy sync_status projection used by automation workers. */
export function nationalSupportCompatibilityProjection(
  code: NationalSupportResultCode,
  syncErrorMessage: string | null = null,
) {
  return {
    sync_status: nationalSupportCompatibilityStatus(code),
    sync_error_message: syncErrorMessage,
    updated_at: new Date().toISOString(),
  };
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
  if (!Array.isArray(data)) {
    throw new Error("measurement_journal 조회 응답 형식이 올바르지 않습니다.");
  }
  return data.length > 0;
}
