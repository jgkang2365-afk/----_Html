import type { SupabaseClient } from "@supabase/supabase-js";

export const AUTOMATION_JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "CONFIRM_REQUIRED",
] as const;

export type AutomationJobStatus = (typeof AUTOMATION_JOB_STATUSES)[number];

export type AutomationJob = {
  id: string;
  job_type: string;
  status: AutomationJobStatus;
  idempotency_key: string;
  target_key: string | null;
  request_payload: Record<string, unknown>;
  progress_stage: string | null;
  progress_percent: number;
  result_code: string | null;
  result_payload: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  worker_id: string | null;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  cancel_requested_at: string | null;
  effect_started_at: string | null;
  effect_confirmed_at: string | null;
};

export type AutomationJobUpdate = Pick<
  Partial<AutomationJob>,
  | "status"
  | "progress_stage"
  | "progress_percent"
  | "result_code"
  | "result_payload"
  | "error_code"
  | "error_message"
  | "effect_started_at"
  | "effect_confirmed_at"
>;

export function terminalAutomationStatus(status: AutomationJobStatus) {
  return ["COMPLETED", "FAILED", "CANCELLED", "CONFIRM_REQUIRED"].includes(status);
}

export async function enqueueAutomationJob(
  supabase: SupabaseClient,
  input: {
    jobType: string;
    idempotencyKey: string;
    targetKey?: string | null;
    requestPayload?: Record<string, unknown>;
    requestedBy?: number | null;
  },
) {
  const { data, error } = await supabase.rpc("enqueue_automation_job", {
    p_job_type: input.jobType,
    p_idempotency_key: input.idempotencyKey,
    p_target_key: input.targetKey ?? null,
    p_request_payload: input.requestPayload ?? {},
    p_requested_by: input.requestedBy ?? null,
  });
  if (error) throw error;
  return data as AutomationJob;
}

export async function claimNextAutomationJob(
  supabase: SupabaseClient,
  workerId: string,
  jobTypes: string[],
) {
  const { data, error } = await supabase.rpc("claim_next_automation_job", {
    p_worker_id: workerId,
    p_job_types: jobTypes,
  });
  if (error) throw error;
  return ((data || [])[0] ?? null) as AutomationJob | null;
}

export async function updateAutomationJob(
  supabase: SupabaseClient,
  jobId: string,
  update: AutomationJobUpdate,
) {
  const status = update.status;
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = { ...update, updated_at: now };
  if (terminalAutomationStatus(status ?? "PENDING")) payload.finished_at = now;
  if (status === "CANCEL_REQUESTED") payload.cancel_requested_at = now;

  const { data, error } = await supabase
    .from("automation_jobs")
    .update(payload)
    .eq("id", jobId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("AUTOMATION_JOB_NOT_FOUND");
  return data as AutomationJob;
}

export function mesManualIdempotencyKey(requestId: string) {
  return `mes:manual:${requestId}`;
}

export function mesScheduledIdempotencyKey(slot: string, date: string) {
  return `mes:scheduled:${date}:${slot}`;
}

export function documentIdempotencyKey(
  businessId: number,
  selectedDocuments: string[],
  templateVersions: string[],
) {
  return `document:${businessId}:${selectedDocuments.slice().sort().join(",")}:${templateVersions.slice().sort().join(",")}`;
}

export function nationalSupportIdempotencyKey(
  mode: "lookup" | "apply" | "scheduled_lookup",
  code: string,
  year: number | string,
  period: string,
  date?: string,
) {
  const suffix = date ? `:${date}` : "";
  return `national-support:${mode}:${code}:${year}:${period}${suffix}`;
}
