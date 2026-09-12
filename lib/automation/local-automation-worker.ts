import { createAdminClient } from "@/lib/supabase/admin";
import { claimNextAutomationJob, updateAutomationJobOwned } from "@/lib/automation/jobs";
import { processNationalSupportJob, type NationalSupportJobPayload } from "@/lib/automation/national-support-worker";
import { hasMeasurementJournalForTarget, nationalSupportCompatibilityProjection, type NationalSupportResultCode } from "@/lib/national-support/automation-contract";
import { syncToMasterTables } from "@/lib/sync/master-tables";

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
  private delayedWakeTimer: ReturnType<typeof setTimeout> | null = null;
  private delayedWakeAt: number | null = null;

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
        event: "*", schema: "public", table: "automation_job_signals", filter: "job_type=eq.NATIONAL_SUPPORT",
      }, (payload) => {
        const signal = payload.new as { status?: string; available_at?: string } | null;
        if (signal?.status === "PENDING" && signal.available_at) {
          this.scheduleDelayedWake(supabase, new Date(signal.available_at));
          if (new Date(signal.available_at).getTime() <= Date.now()) wake();
          return;
        }
        wake();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") wake();
      });
    wake(); // allowed one-time startup reconciliation
  }

  /**
   * Future jobs are durable in Postgres.  The timer merely turns their
   * available_at boundary into a one-time drain; it is never an idle poller.
   */
  private async scheduleEarliestFuture(supabase: ReturnType<typeof createAdminClient>) {
    const { data, error } = await supabase.from("automation_jobs")
      .select("available_at")
      .eq("job_type", NATIONAL_SUPPORT).eq("status", "PENDING")
      .gt("available_at", new Date().toISOString())
      .order("available_at", { ascending: true }).limit(1);
    if (error) throw error;
    const availableAt = data?.[0]?.available_at;
    if (!availableAt) {
      this.clearDelayedWake();
      return;
    }
    this.scheduleDelayedWake(supabase, new Date(availableAt));
  }

  private clearDelayedWake() {
    if (this.delayedWakeTimer) clearTimeout(this.delayedWakeTimer);
    this.delayedWakeTimer = null;
    this.delayedWakeAt = null;
  }

  private scheduleDelayedWake(supabase: ReturnType<typeof createAdminClient>, availableAt: Date) {
    const at = availableAt.getTime();
    if (!Number.isFinite(at)) return;
    // A later signal cannot displace an earlier pending job.  An earlier
    // signal replaces the old one-shot timer exactly once.
    if (this.delayedWakeAt !== null && this.delayedWakeAt <= at) return;
    this.clearDelayedWake();
    const delay = Math.max(0, Math.min(at - Date.now(), 2_147_483_647));
    this.delayedWakeAt = at;
    this.delayedWakeTimer = setTimeout(() => {
      this.delayedWakeTimer = null;
      this.delayedWakeAt = null;
      void this.drain().catch(() => undefined);
    }, delay);
  }

  private async completeTerminal(
    jobId: string, payload: NationalSupportJobPayload,
    status: "COMPLETED" | "FAILED" | "CONFIRM_REQUIRED",
    code: NationalSupportResultCode | null, error: string | null = null,
    effectConfirmed = false,
  ) {
    const { error: rpcError } = await createAdminClient().rpc("complete_national_support_automation_job", {
      p_job_id: jobId, p_worker_id: workerId, p_status: status, p_result_code: code,
      p_result_payload: code ? { result_code: code } : null,
      p_error_code: error ? "NATIONAL_SUPPORT_WORKER_ERROR" : null,
      p_error_message: error, p_target_id: Number(payload.target_id),
      p_sync_status: status === "FAILED" ? "실패" : nationalSupportCompatibilityProjection(code!).sync_status,
      p_sync_error_message: error,
      p_effect_confirmed: effectConfirmed,
    });
    if (rpcError) throw rpcError;
  }

  /** Secondary master projection follows the authoritative terminal commit. */
  private async projectFinalMaster(payload: NationalSupportJobPayload) {
    try {
      const admin = createAdminClient();
      const { data: target, error } = await admin.from("measurement_target_business")
        .select("business_name").eq("id", payload.target_id).single();
      if (error) throw error;
      await syncToMasterTables(admin, payload.code, Number(payload.year), payload.period,
        target?.business_name || "미등록 사업장", payload.representative || null,
        payload.sanjae || null, payload.commencement || null,
        { updateBusinessInfo: false });
    } catch (error) {
      // Do not turn a confirmed final result into FAILED or replay a portal action.
      console.error("[LocalAutomationWorker] 건강디딤돌 master 보조 반영 실패", error);
    }
  }

  private async projectRunning(payload: NationalSupportJobPayload) {
    const { error } = await createAdminClient().from("measurement_target_business").update({
      sync_status: "조회중", sync_error_message: null, updated_at: new Date().toISOString(),
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
        let effectStarted = false;
        try {
          await this.projectRunning(payload);
          await updateAutomationJobOwned(supabase, job.id, workerId, { progress_stage: "신청조건 확인", progress_percent: 20 });
          // Guard 1: a journal makes both lookup scheduling and application ineligible.
          if (await hasMeasurementJournalForTarget(supabase, payload)) {
            await this.completeTerminal(job.id, payload, "COMPLETED", "JOURNAL_REGISTERED_SKIP");
            continue;
          }
          const result = await processNationalSupportJob(payload, {
            onWorkerEvent: async (event) => {
              if (event === "journal_guard_before_apply") {
                return { allow: !(await hasMeasurementJournalForTarget(supabase, payload)) };
              }
              if (event === "effect_started") {
                effectStarted = true;
                await updateAutomationJobOwned(supabase, job.id, workerId, {
                  effect_started_at: new Date().toISOString(),
                  progress_stage: "신청 요청 전송", progress_percent: 70,
                });
                return { allow: true };
              }
              return { allow: false };
            },
          });
          const code = result.resultCode;
          if (result.followUp) {
            const attempt = Number(result.followUp.payload.attempt_count || 0);
            const followupKey = `national-support:final:${payload.code}:${payload.year}:${payload.period}:${job.id}:${attempt}`;
            const { error } = await supabase.rpc("complete_automation_job_with_followup", {
              p_job_id: job.id, p_worker_id: workerId, p_result_code: code,
              p_result_payload: { result_code: code }, p_followup_key: followupKey,
              p_followup_payload: result.followUp.payload,
              p_available_at: result.followUp.availableAt.toISOString(),
              p_target_id: Number(payload.target_id),
              p_sync_status: nationalSupportCompatibilityProjection(code).sync_status,
              p_sync_error_message: null,
            });
            if (error) throw error;
            continue;
          }
          await this.completeTerminal(job.id, payload,
            code === "APPLICATION_UNCERTAIN" ? "CONFIRM_REQUIRED" : "COMPLETED",
            code, null, effectStarted && code === "APPLIED_WAITING_RESULT");
          if (code === "SUPPORT" || code === "NON_SUPPORT") {
            await this.projectFinalMaster(payload);
          }
        } catch (error: any) {
          const uncertain = effectStarted;
          await this.completeTerminal(job.id, payload, uncertain ? "CONFIRM_REQUIRED" : "FAILED",
            uncertain ? "APPLICATION_UNCERTAIN" : null, error?.message || String(error));
        }
      }
    } finally {
      this.draining = false;
      // Startup, reconnect, and every completed drain perform this one read
      // to recover the earliest durable future job.  There is no interval.
      try {
        await this.scheduleEarliestFuture(supabase);
      } catch (error) {
        console.error("[LocalAutomationWorker] future job 예약 조회 실패", error);
      }
    }
  }
}
