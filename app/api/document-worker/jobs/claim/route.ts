import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

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
  const { data, error } = await createAdminClient().rpc("claim_next_document_generation_job", {
    p_worker_id: workerId,
    p_worker_lease_id: workerLeaseId,
  });
  if (error) return NextResponse.json({ error: "작업 선점에 실패했습니다." }, { status: 500 });
  return NextResponse.json({ job: data?.[0] || null });
}
