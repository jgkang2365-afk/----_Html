import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

export const dynamic = "force-dynamic";

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
