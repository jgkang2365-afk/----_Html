import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorizedDocumentWorker(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await createAdminClient().rpc(
    "recover_cancelled_document_generation_jobs"
  );
  if (error) return NextResponse.json({ error: "취소 요청 고아 작업 복구 실패" }, { status: 500 });

  return NextResponse.json({
    recovered: (data || []).map((job: { id: string; status: string }) => ({
      id: job.id,
      status: job.status,
    })),
  });
}
