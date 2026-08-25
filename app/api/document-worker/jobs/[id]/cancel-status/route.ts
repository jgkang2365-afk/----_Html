import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorizedDocumentWorker(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const workerId = String(body.worker_id || "").trim();
  const workerLeaseId = String(body.worker_lease_id || "").trim();
  if (!workerId || !workerLeaseId)
    return NextResponse.json(
      { error: "worker_id와 worker_lease_id가 필요합니다." },
      { status: 400 }
    );

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("renew_document_generation_job_lease", {
    p_job_id: params.id,
    p_worker_id: workerId,
    p_worker_lease_id: workerLeaseId,
    p_result_files: Array.isArray(body.result_files) ? body.result_files : null,
  });
  if (error) return NextResponse.json({ error: "Worker lease 갱신 실패" }, { status: 500 });
  if (data?.[0])
    return NextResponse.json({
      cancel_requested: Boolean(data[0].cancel_requested),
      status: data[0].status,
      lease_expires_at: data[0].lease_expires_at,
    });

  // recovery가 먼저 종결한 동일 lease라면 Worker가 안전 지점에서 취소로 종료할 수 있게 한다.
  const terminal = await admin
    .from("document_generation_jobs")
    .select("id, status, cancel_requested_at, cancelled_at")
    .eq("id", params.id)
    .eq("worker_id", workerId)
    .eq("worker_lease_id", workerLeaseId)
    .maybeSingle();
  if (terminal.error) return NextResponse.json({ error: "취소 상태 조회 실패" }, { status: 500 });
  if (terminal.data?.status === "CANCELLED" || terminal.data?.status === "PARTIAL_SUCCESS")
    return NextResponse.json({ cancel_requested: true, status: terminal.data.status });

  return NextResponse.json({ error: "Worker lease가 유효하지 않습니다." }, { status: 409 });
}

// migration/API 배포 중 기존 PR #53 Worker의 안전 지점 조회만 호환한다. lease는 갱신하지 않는다.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorizedDocumentWorker(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workerId = new URL(request.url).searchParams.get("workerId")?.trim();
  if (!workerId) return NextResponse.json({ error: "workerId가 필요합니다." }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("document_generation_jobs")
    .select("id, status, cancel_requested_at, cancelled_at")
    .eq("id", params.id)
    .eq("worker_id", workerId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "취소 상태 조회 실패" }, { status: 500 });
  if (!data)
    return NextResponse.json({ error: "현재 Worker가 선점한 작업이 아닙니다." }, { status: 409 });

  return NextResponse.json({
    cancel_requested: Boolean(data.cancel_requested_at) || data.status === "CANCELLED",
    status: data.status,
  });
}
