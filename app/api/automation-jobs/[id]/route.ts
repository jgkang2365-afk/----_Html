import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { supportsGenericAutomationCancellation, unsupportedCancellationCode } from "@/lib/automation/jobs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await checkPermission("journal:write");
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const { data, error } = await createAdminClient()
      .from("automation_jobs")
      .select("id, job_type, status, idempotency_key, target_key, progress_stage, progress_percent, result_code, result_payload, error_code, error_message, worker_id, created_at, claimed_at, started_at, finished_at, updated_at, cancel_requested_at, effect_started_at, effect_confirmed_at")
      .eq("id", params.id)
      .eq("requested_by", Number(user.id))
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ job: data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "작업 상태 조회 실패" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await checkPermission("journal:write");
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const admin = createAdminClient();
    const { data: owned, error: lookupError } = await admin.from("automation_jobs")
      .select("job_type").eq("id", params.id).eq("requested_by", Number(user.id)).maybeSingle();
    if (lookupError) throw lookupError;
    if (!owned) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
    if (!supportsGenericAutomationCancellation(owned.job_type)) {
      return NextResponse.json({
        error: "이 작업 유형의 취소는 지원하지 않습니다.",
        errorCode: unsupportedCancellationCode(owned.job_type),
      }, { status: 409 });
    }
    const now = new Date().toISOString();
    const pending = await admin.from("automation_jobs")
      .update({ status: "CANCELLED", progress_stage: "실행 전 취소됨", progress_percent: 100, finished_at: now, updated_at: now })
      .eq("id", params.id).eq("requested_by", Number(user.id)).eq("job_type", "MES_SYNC").eq("status", "PENDING")
      .select("*").maybeSingle();
    if (pending.error) throw pending.error;
    if (pending.data) return NextResponse.json({ success: true, job: pending.data });

    const running = await admin.from("automation_jobs")
      .update({ status: "CANCEL_REQUESTED", progress_stage: "취소 요청 전달", cancel_requested_at: now, updated_at: now })
      .eq("id", params.id).eq("requested_by", Number(user.id)).eq("job_type", "MES_SYNC").eq("status", "RUNNING")
      .select("*").maybeSingle();
    if (running.error) throw running.error;
    if (running.data) return NextResponse.json({ success: true, job: running.data });
    return NextResponse.json({ error: "취소할 실행 중 작업이 없거나 권한이 없습니다." }, { status: 409 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "작업 취소 요청 실패" }, { status: 500 });
  }
}
