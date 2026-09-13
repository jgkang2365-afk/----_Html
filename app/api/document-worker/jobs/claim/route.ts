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
  const admin = createAdminClient();
  try {
    // Restart/reconnect recovery only marks uncertain interrupted work. It
    // never replays a document generation whose file effect is unknown.
    const { error: reconcileError } = await admin.rpc("reconcile_stale_document_automation_jobs");
    if (reconcileError) throw reconcileError;
    const { data: claimed, error } = await admin.rpc("claim_next_document_automation_job", {
      p_worker_id: workerId,
      p_worker_lease_id: workerLeaseId,
    });
    if (error) throw error;
    return NextResponse.json({ job: claimed || null });
  } catch (error) {
    console.error("[DocumentWorker] 공통 작업 선점 실패", error);
    return NextResponse.json({ error: "작업 선점에 실패했습니다." }, { status: 500 });
  }
}
