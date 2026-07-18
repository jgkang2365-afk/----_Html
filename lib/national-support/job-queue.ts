import type { NationalSupportJobPayload } from "@/lib/automation/national-support-worker";

export type NationalSupportQueuePayload = NationalSupportJobPayload & {
  requested_by?: number | string;
  attempt_count?: number;
};

export async function enqueueNationalSupportJob(
  supabase: any,
  payload: NationalSupportQueuePayload,
  availableAt = new Date(),
) {
  const mode = payload.mode || "lookup_only";
  const { data: active, error: activeError } = await supabase
    .from("background_jobs")
    .select("id")
    .eq("job_type", "national_support")
    .in("status", ["pending", "processing", "cancel_requested"])
    .contains("payload", { target_id: payload.target_id, mode })
    .limit(1);
  if (activeError) throw activeError;
  if (active?.length) return { queued: false, duplicate: true };

  const { error } = await supabase.from("background_jobs").insert({
    job_type: "national_support",
    status: "pending",
    available_at: availableAt.toISOString(),
    attempt_count: payload.attempt_count || 0,
    payload: { ...payload, mode },
  });
  if (error?.code === "23505") return { queued: false, duplicate: true };
  if (error) throw error;
  return { queued: true, duplicate: false };
}
