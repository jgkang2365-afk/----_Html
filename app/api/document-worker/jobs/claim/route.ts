import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";
import { claimNextAutomationJob, updateAutomationJob } from "@/lib/automation/jobs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorizedDocumentWorker(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { worker_id, worker_lease_id } = await request.json().catch(() => ({}));
  const workerId = String(worker_id || "").trim();
  const workerLeaseId = String(worker_lease_id || "").trim();
  if (!workerId) return NextResponse.json({ error: "worker_id가 필요합니다." }, { status: 400 });
  if (!workerLeaseId)
    return NextResponse.json({ error: "worker_lease_id가 필요합니다." }, { status: 400 });
  const admin = createAdminClient();
  try {
    // Restart/reconnect recovery only marks uncertain interrupted work. It
    // never replays a document generation whose file effect is unknown.
    const { error: reconcileError } = await admin.rpc("reconcile_stale_automation_jobs", {
      p_job_types: ["DOCUMENT_GENERATION"],
    });
    if (reconcileError) throw reconcileError;
    const automationJob = await claimNextAutomationJob(admin, workerId, ["DOCUMENT_GENERATION"]);
    if (!automationJob) return NextResponse.json({ job: null });
    const legacyId = String(automationJob.request_payload?.document_generation_job_id || "");
    if (!legacyId) {
      await updateAutomationJob(admin, automationJob.id, {
        status: "FAILED", error_code: "DOCUMENT_LEGACY_JOB_MISSING", error_message: "문서 작업 원본 ID가 없습니다.", progress_percent: 100,
      });
      return NextResponse.json({ job: null });
    }
    const now = new Date().toISOString();
    const { data: legacy, error } = await admin
      .from("document_generation_jobs")
      .update({ status: "PROCESSING", worker_id: workerId, worker_lease_id: workerLeaseId, started_at: now, updated_at: now })
      .eq("id", legacyId).eq("status", "PENDING")
      .select("*").maybeSingle();
    if (error || !legacy) {
      await updateAutomationJob(admin, automationJob.id, {
        status: "CONFIRM_REQUIRED", error_code: "DOCUMENT_LEGACY_CLAIM_UNCERTAIN",
        error_message: "문서 원본 작업을 안전하게 선점하지 못했습니다.", progress_percent: 100,
      });
      return NextResponse.json({ job: null });
    }
    await updateAutomationJob(admin, automationJob.id, { progress_stage: "문서 생성", progress_percent: 25 });
    return NextResponse.json({ job: { ...legacy, automation_job_id: automationJob.id } });
  } catch (error) {
    console.error("[DocumentWorker] 공통 작업 선점 실패", error);
    return NextResponse.json({ error: "작업 선점에 실패했습니다." }, { status: 500 });
  }
}
