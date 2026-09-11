import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorizedDocumentWorker(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const workerLeaseId = String(body.worker_lease_id || "").trim();
  if (!workerLeaseId)
    return NextResponse.json({ error: "worker_lease_id가 필요합니다." }, { status: 400 });
  const status = String(body.status || "");
  if (!["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(status))
    return NextResponse.json({ error: "완료 상태가 올바르지 않습니다." }, { status: 400 });
  const admin = createAdminClient();
  const resultFiles: Array<Record<string, unknown>> = Array.isArray(body.result_files)
    ? body.result_files
    : [];
  const automationJobId = String(body.automation_job_id || "").trim();
  const effectUncertain = body.effect_uncertain === true;
  if (!automationJobId)
    return NextResponse.json({ error: "공통 automation 작업 ID가 필요합니다." }, { status: 400 });
  const { data, error } = await admin.rpc("complete_document_automation_job", {
    p_legacy_job_id: params.id,
    p_automation_job_id: automationJobId,
    p_worker_id: String(body.worker_id || ""),
    p_worker_lease_id: workerLeaseId,
    p_legacy_status: status,
    p_result_files: resultFiles,
    p_error_message: body.error_message ? String(body.error_message).slice(0, 4000) : null,
    p_effect_uncertain: effectUncertain,
  });
  if (error) {
    const conflict = /NOT_OWNED/i.test(error.message || "");
    return NextResponse.json({ error: conflict ? "현재 Worker가 선점한 작업이 아닙니다." : "작업 완료 상태 저장 실패" }, { status: conflict ? 409 : 500 });
  }
  return NextResponse.json({ success: true, job: data });
}
