import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

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
  const { error } = await admin.rpc("mark_document_automation_effect_started", {
    p_legacy_job_id: params.id, p_automation_job_id: automationJobId,
    p_worker_id: workerId, p_worker_lease_id: workerLeaseId,
  });
  if (error) {
    const conflict = /NOT_OWNED/i.test(error.message || "");
    return NextResponse.json({ error: conflict ? "현재 Worker가 선점한 작업이 아닙니다." : "문서 작업 확인 실패" }, { status: conflict ? 409 : 500 });
  }
  return NextResponse.json({ success: true });
}
