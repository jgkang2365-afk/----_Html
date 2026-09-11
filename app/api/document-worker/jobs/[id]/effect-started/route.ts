import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";
import { updateAutomationJob } from "@/lib/automation/jobs";

/** Marks the irreversible final-output publish boundary before copy/replace. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorizedDocumentWorker(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const workerId = String(body.worker_id || "").trim();
  const workerLeaseId = String(body.worker_lease_id || "").trim();
  const automationJobId = String(body.automation_job_id || "").trim();
  if (!workerId || !workerLeaseId || !automationJobId)
    return NextResponse.json({ error: "Worker 및 automation 작업 식별자가 필요합니다." }, { status: 400 });
  const admin = createAdminClient();
  const { data: legacy, error } = await admin.from("document_generation_jobs").select("id")
    .eq("id", params.id).eq("status", "PROCESSING").eq("worker_id", workerId)
    .eq("worker_lease_id", workerLeaseId).maybeSingle();
  if (error) return NextResponse.json({ error: "문서 작업 확인 실패" }, { status: 500 });
  if (!legacy) return NextResponse.json({ error: "현재 Worker가 선점한 작업이 아닙니다." }, { status: 409 });
  const { data: common, error: commonError } = await admin.from("automation_jobs")
    .select("id, status, worker_id, request_payload").eq("id", automationJobId).maybeSingle();
  if (commonError || !common || common.status !== "RUNNING" || common.worker_id !== workerId ||
      String((common.request_payload as Record<string, unknown>)?.document_generation_job_id || "") !== params.id)
    return NextResponse.json({ error: "공통 작업 ownership 확인 실패" }, { status: 409 });
  await updateAutomationJob(admin, automationJobId, {
    effect_started_at: new Date().toISOString(), progress_stage: "최종 파일 게시", progress_percent: 70,
  });
  return NextResponse.json({ success: true });
}
