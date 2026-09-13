import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    await checkPermission("journal:write");
    const user = await getUser();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("cancel_document_automation_job", {
      p_legacy_job_id: params.jobId,
      p_requested_by: user ? Number(user.id) : null,
    });
    if (error) throw error;
    const recovery = await admin.rpc("recover_cancelled_document_generation_jobs");
    if (recovery.error) console.error("[DocumentCancel] 취소 복구 조회 실패", recovery.error);
    const current = await admin.from("document_generation_jobs")
      .select("id, status, cancel_requested_at, cancel_requested_by, cancelled_at, completed_at, updated_at")
      .eq("id", params.jobId).single();
    if (current.error) throw current.error;
    return NextResponse.json({ success: true, job: current.data ?? data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "문서 생성 취소 요청 실패" }, { status: 500 });
  }
}
