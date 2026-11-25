import type { SupabaseClient } from "@supabase/supabase-js";

type Target = { id: number | string; sync_status?: string | null; sync_error_message?: string | null };

/** 조회중 표시는 실제 활성 job 증거가 없을 때만 읽기 응답에서 복구한다. DB 원본은 보존한다. */
export async function projectNationalSupportOrphanStatuses<T extends Target>(
  supabase: SupabaseClient<any>, targets: T[],
): Promise<T[]> {
  const pending = targets.filter(target => target.sync_status === "조회중" || target.sync_status === "신청중");
  if (!pending.length) return targets;
  const keys = pending.map(target => `national-support:${target.id}`);
  const { data: common, error: commonError } = await supabase.from("automation_jobs")
    .select("target_key,status")
    .eq("job_type", "NATIONAL_SUPPORT")
    .in("target_key", keys)
    .in("status", ["PENDING", "RUNNING", "CANCEL_REQUESTED", "CONFIRM_REQUIRED"]);
  if (commonError) throw commonError;
  const { data: legacy, error: legacyError } = await supabase.from("background_jobs")
    .select("payload")
    .eq("job_type", "national_support")
    .in("status", ["pending", "processing", "cancel_requested"]);
  if (legacyError) throw legacyError;
  const active = new Set((common || []).filter(job => job.status !== "CONFIRM_REQUIRED")
    .map(job => String(job.target_key)));
  for (const job of legacy || []) {
    const targetId = job.payload?.target_id;
    if (targetId != null) active.add(`national-support:${targetId}`);
  }
  const confirmRequired = new Set((common || []).filter(job => job.status === "CONFIRM_REQUIRED")
    .map(job => String(job.target_key)));
  return targets.map(target => {
    if (target.sync_status !== "조회중" && target.sync_status !== "신청중") return target;
    const key = `national-support:${target.id}`;
    if (active.has(key)) return target;
    return { ...target,
      sync_status: confirmRequired.has(key) ? "수동확인필요" : "확인대기",
      sync_error_message: confirmRequired.has(key)
        ? "작업 결과 확인이 필요합니다. 기존 신청 내역을 먼저 확인해 주세요."
        : "실행 중인 건강디딤돌 작업이 없습니다. 결과를 다시 확인해 주세요.",
    };
  });
}
