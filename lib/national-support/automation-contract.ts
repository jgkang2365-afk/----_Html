import type { SupabaseClient } from "@supabase/supabase-js";

export const NATIONAL_SUPPORT_RESULT_CODES = [
  "SUPPORT", "NON_SUPPORT", "OVER_50_RECHECK", "NO_EMPLOYEE_INFO_RECHECK",
  "EMPLOYEE_CHECK_FAILED_RECHECK", "JOURNAL_REGISTERED_SKIP", "TARGET_STATUS_SKIP", "REPRESENTATIVE_REVIEW_SKIP", "APPLICATION_INFO_CHANGED_SKIP",
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
    case "TARGET_STATUS_SKIP":
    case "REPRESENTATIVE_REVIEW_SKIP":
    case "APPLICATION_INFO_CHANGED_SKIP": return "확인대기";
    case "OVER_50_RECHECK":
    case "NO_EMPLOYEE_INFO_RECHECK":
    case "EMPLOYEE_CHECK_FAILED_RECHECK": return "비대상대기";
    case "APPLIED_WAITING_RESULT": return "신청완료대기";
    case "ALREADY_APPLIED": return "확인대기";
    case "LOOKUP_NO_RESULT": return "조회대기";
    case "APPLICATION_UNCERTAIN": return "수동확인필요";
  }
}

export function canAutomateNationalSupportForTargetStatus(status: unknown) {
  return status === "미실시" || status === "실시";
}

export type NationalSupportRequestIntent = "direct" | "automatic";
export type NationalSupportJobMode = "lookup_only" | "apply_if_missing" | "final_lookup";

/** 계획 상태와 실적 일지를 따로 판정한다. 알 수 없는 상태는 실행하지 않는다. */
export function nationalSupportExecutionDecision(input: {
  status: unknown;
  period: unknown;
  hasJournal: boolean;
  intent: NationalSupportRequestIntent;
  mode: NationalSupportJobMode;
  beforeApply?: boolean;
}) {
  if (input.mode === "final_lookup") return { action: "run" as const, mode: "final_lookup" as const };
  if (input.period == null || String(input.period).includes("(수시)") ||
      !canAutomateNationalSupportForTargetStatus(input.status)) {
    return { action: "skip" as const, resultCode: "TARGET_STATUS_SKIP" as const };
  }
  if (input.hasJournal) {
    if (!input.beforeApply && input.intent === "direct") {
      return { action: "run" as const, mode: "lookup_only" as const };
    }
    return { action: "skip" as const, resultCode: "JOURNAL_REGISTERED_SKIP" as const };
  }
  return { action: "run" as const, mode: input.mode };
}

/** Read the live exact target and exact journal key at each enqueue/worker boundary. */
export async function readNationalSupportExecutionDecision(
  supabase: SupabaseClient<any>,
  target: { target_id: number | string; code: string; year: number | string; period: string },
  input: { intent: NationalSupportRequestIntent; mode: NationalSupportJobMode; beforeApply?: boolean },
) {
  if (input.mode === "final_lookup") return nationalSupportExecutionDecision({
    status: "실시", period: target.period, hasJournal: false, ...input,
  });
  const { data, error } = await supabase.from("measurement_target_business")
    .select("id,code,year,period,is_registered")
    .eq("id", target.target_id).maybeSingle();
  if (error) throw error;
  if (!data || String(data.code) !== String(target.code) ||
      Number(data.year) !== Number(target.year) || String(data.period) !== String(target.period)) {
    throw new Error("NATIONAL_SUPPORT_TARGET_KEY_MISMATCH");
  }
  if (!canAutomateNationalSupportForTargetStatus(data.is_registered)) {
    return nationalSupportExecutionDecision({ status: data.is_registered, period: data.period,
      hasJournal: false, ...input });
  }
  const hasJournal = await hasMeasurementJournalForTarget(supabase, data);
  return nationalSupportExecutionDecision({ status: data.is_registered, period: data.period,
    hasJournal, ...input });
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

/** Exact journal existence for list rows, without the unrelated journal history cap. */
export async function readNationalSupportJournalCodes(
  supabase: SupabaseClient<any>, codes: string[], year: number, period: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  const uniqueCodes = [...new Set(codes)];
  const pageSize = 250;
  for (let chunk = 0; chunk < uniqueCodes.length; chunk += 100) {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("measurement_journal").select("code")
        .eq("measurement_year", year).eq("measurement_period", period)
        .in("code", uniqueCodes.slice(chunk, chunk + 100)).order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("측정일지 목록을 확인할 수 없습니다.");
      for (const row of data) found.add(row.code);
      if (data.length < pageSize) break;
    }
  }
  return found;
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
