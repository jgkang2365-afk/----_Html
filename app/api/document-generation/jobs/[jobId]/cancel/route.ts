import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const JOB_FIELDS =
  "id, status, cancel_requested_at, cancel_requested_by, cancelled_at, completed_at, updated_at";

export async function POST(_request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    await checkPermission("journal:write");
    const user = await getUser();
    const requestedBy = user ? Number(user.id) : null;
    const now = new Date().toISOString();
    const admin = createAdminClient();

    // claim과 동일한 status 조건부 UPDATE를 사용한다. 먼저 잠근 쪽의 상태만 성공한다.
    const pendingResult = await admin
      .from("document_generation_jobs")
      .update({
        status: "CANCELLED",
        cancel_requested_at: now,
        cancel_requested_by: requestedBy,
        cancelled_at: now,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", params.jobId)
      .eq("status", "PENDING")
      .select(JOB_FIELDS)
      .maybeSingle();
    if (pendingResult.error) throw pendingResult.error;
    if (pendingResult.data) return NextResponse.json({ success: true, job: pendingResult.data });

    const processingResult = await admin
      .from("document_generation_jobs")
      .update({
        cancel_requested_at: now,
        cancel_requested_by: requestedBy,
        updated_at: now,
      })
      .eq("id", params.jobId)
      .eq("status", "PROCESSING")
      .is("cancel_requested_at", null)
      .select(JOB_FIELDS)
      .maybeSingle();
    if (processingResult.error) throw processingResult.error;
    if (processingResult.data)
      return NextResponse.json({ success: true, job: processingResult.data });

    // 중복 요청 또는 완료 race에서는 과거 결과를 변경하지 않고 현재 상태를 반환한다.
    const currentResult = await admin
      .from("document_generation_jobs")
      .select(JOB_FIELDS)
      .eq("id", params.jobId)
      .maybeSingle();
    if (currentResult.error) throw currentResult.error;
    if (!currentResult.data)
      return NextResponse.json({ error: "문서 생성 작업을 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({
      success: true,
      already_requested: Boolean(currentResult.data.cancel_requested_at),
      already_terminal: !["PENDING", "PROCESSING"].includes(currentResult.data.status),
      job: currentResult.data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "문서 생성 취소 요청 실패" },
      { status: 500 }
    );
  }
}
