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
  const cancellationHandled =
    status === "CANCELLED" || resultFiles.some((file) => file?.status === "CANCELLED");
  const completedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("document_generation_jobs")
    .update({
      status,
      result_files: resultFiles,
      error_message: body.error_message ? String(body.error_message).slice(0, 4000) : null,
      completed_at: completedAt,
      cancelled_at: cancellationHandled ? completedAt : null,
      updated_at: completedAt,
    })
    .eq("id", params.id)
    .eq("status", "PROCESSING")
    .eq("worker_id", String(body.worker_id || ""))
    .eq("worker_lease_id", workerLeaseId)
    .select("id, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "작업 완료 상태 저장 실패" }, { status: 500 });
  if (!data)
    return NextResponse.json({ error: "현재 Worker가 선점한 작업이 아닙니다." }, { status: 409 });
  return NextResponse.json({ success: true, job: data });
}
