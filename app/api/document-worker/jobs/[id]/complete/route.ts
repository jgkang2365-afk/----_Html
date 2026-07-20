import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorizedDocumentWorker(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const status = String(body.status || "");
  if (!["COMPLETED", "PARTIAL_SUCCESS", "FAILED"].includes(status))
    return NextResponse.json({ error: "완료 상태가 올바르지 않습니다." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("document_generation_jobs")
    .update({
      status,
      result_files: Array.isArray(body.result_files) ? body.result_files : [],
      error_message: body.error_message ? String(body.error_message).slice(0, 4000) : null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("status", "PROCESSING")
    .eq("worker_id", String(body.worker_id || ""))
    .select("id, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "작업 완료 상태 저장 실패" }, { status: 500 });
  if (!data)
    return NextResponse.json({ error: "현재 Worker가 선점한 작업이 아닙니다." }, { status: 409 });
  return NextResponse.json({ success: true, job: data });
}
