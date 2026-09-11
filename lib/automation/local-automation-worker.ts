import { createAdminClient } from "@/lib/supabase/admin";
import { claimNextAutomationJob, updateAutomationJob } from "@/lib/automation/jobs";
import { processNationalSupportJob, type NationalSupportJobPayload } from "@/lib/automation/national-support-worker";
import { hasMeasurementJournalForTarget, nationalSupportCompatibilityProjection, type NationalSupportResultCode } from "@/lib/national-support/automation-contract";

const NATIONAL_SUPPORT = "NATIONAL_SUPPORT";
const workerId = `local-automation-${process.pid}`;

/**
 * Windows-local worker for jobs that must not be processed by the web UI.
 * It is event-driven: startup/reconnect drains once, then Realtime wakes it.
 */
export class LocalAutomationWorker {
  private static instance: LocalAutomationWorker | null = null;
  private started = false;
  private draining = false;

  static getInstance() {
    return (this.instance ??= new LocalAutomationWorker());
  }

  start() {
    if (this.started || !process.env.REPORT_STORAGE_ROOT) return;
    this.started = true;
    const supabase = createAdminClient();
    const wake = () => void this.drain();
    supabase.channel("local-automation-worker")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "automation_job_signals",
      }, wake)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") wake();
      });
    wake(); // allowed one-time startup reconciliation
  }

  private async projectCompatibility(payload: NationalSupportJobPayload, code: NationalSupportResultCode) {
    const { error } = await createAdminClient().from("measurement_target_business")
      .update(nationalSupportCompatibilityProjection(code)).eq("id", payload.target_id);
    if (error) throw error;
  }

  private async projectRunning(payload: NationalSupportJobPayload) {
    const { error } = await createAdminClient().from("measurement_target_business").update({
      sync_status: "조회중", sync_error_message: null, updated_at: new Date().toISOString(),
    }).eq("id", payload.target_id);
    if (error) throw error;
  }

  private async projectFailure(payload: NationalSupportJobPayload, message: string) {
    const { error } = await createAdminClient().from("measurement_target_business").update({
      sync_status: "실패", sync_error_message: message, updated_at: new Date().toISOString(),
    }).eq("id", payload.target_id);
    if (error) throw error;
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    const supabase = createAdminClient();
    try {
      await supabase.rpc("reconcile_stale_automation_jobs", { p_job_types: [NATIONAL_SUPPORT] });
      for (;;) {
        const job = await claimNextAutomationJob(supabase, workerId, [NATIONAL_SUPPORT]);
        if (!job) return;
        const payload = job.request_payload as NationalSupportJobPayload;
        try {
          await this.projectRunning(payload);
          await updateAutomationJob(supabase, job.id, { progress_stage: "신청조건 확인", progress_percent: 20 });
          // Guard 1: a journal makes both lookup scheduling and application ineligible.
          if (await hasMeasurementJournalForTarget(supabase, payload)) {
            await updateAutomationJob(supabase, job.id, {
              status: "COMPLETED", progress_stage: "측정일지 등록으로 제외", progress_percent: 100,
              result_code: "JOURNAL_REGISTERED_SKIP",
            });
            await this.projectCompatibility(payload, "JOURNAL_REGISTERED_SKIP");
            continue;
          }
          let effectStarted = false;
          const result = await processNationalSupportJob(payload, {
            onWorkerEvent: async (event) => {
              if (event === "journal_guard_before_apply") {
                return { allow: !(await hasMeasurementJournalForTarget(supabase, payload)) };
              }
              if (event === "effect_started") {
                effectStarted = true;
                await updateAutomationJob(supabase, job.id, {
                  effect_started_at: new Date().toISOString(),
                  progress_stage: "신청 요청 전송", progress_percent: 70,
                });
                return { allow: true };
              }
              return { allow: false };
            },
          });
          const code = result.resultCode;
          await updateAutomationJob(supabase, job.id, {
            status: code === "APPLICATION_UNCERTAIN" ? "CONFIRM_REQUIRED" : "COMPLETED",
            progress_stage: code === "APPLICATION_UNCERTAIN" ? "신청 결과 확인 필요" : "결과 확인",
            progress_percent: 100, result_code: code,
            result_payload: { result_code: code },
            ...(effectStarted && code !== "APPLICATION_UNCERTAIN"
              ? { effect_confirmed_at: new Date().toISOString() }
              : {}),
          });
          await this.projectCompatibility(payload, code);
        } catch (error: any) {
          const uncertain = payload.mode === "apply_if_missing";
          await updateAutomationJob(supabase, job.id, {
            status: uncertain ? "CONFIRM_REQUIRED" : "FAILED", progress_stage: uncertain ? "외부 효과 확인 필요" : "조회 실패",
            progress_percent: 100, result_code: uncertain ? "APPLICATION_UNCERTAIN" : undefined,
            error_code: "NATIONAL_SUPPORT_WORKER_ERROR", error_message: error?.message || String(error),
          });
          if (uncertain) await this.projectCompatibility(payload, "APPLICATION_UNCERTAIN");
          else await this.projectFailure(payload, error?.message || String(error));
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
