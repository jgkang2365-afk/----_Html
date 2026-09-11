import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { canTriggerMesSync, type UserRole } from "@/lib/permissions";
import { enqueueAutomationJob, mesManualIdempotencyKey } from "@/lib/automation/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireMesSyncAccess() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const supabase = await createClient();
  const { data: user, error } = await supabase.from("users").select("role, job").eq("id", session.userId).maybeSingle();
  if (error) throw error;
  if (!user || !canTriggerMesSync(user.role as UserRole, user.job)) throw new Error("Forbidden");
  return { session, supabase };
}

/** The web only enqueues. The Windows worker claims and changes RUNNING. */
export async function POST(request: NextRequest) {
  try {
    const { session } = await requireMesSyncAccess();
    const requestId = request.headers.get("Idempotency-Key")?.trim();
    if (!requestId || requestId.length > 120) {
      return NextResponse.json({ success: false, error: "Idempotency-Key가 필요합니다." }, { status: 400 });
    }
    const job = await enqueueAutomationJob(createAdminClient(), {
      jobType: "MES_SYNC",
      idempotencyKey: mesManualIdempotencyKey(requestId),
      targetKey: "mes:manual",
      requestPayload: { trigger: "manual", requested_at: new Date().toISOString() },
      requestedBy: Number(session.userId),
    });
    return NextResponse.json({ success: true, job }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    const message = error?.message || "동기화 요청에 실패했습니다.";
    return NextResponse.json({ success: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

/** One explicit read for focus/reconnect recovery; never used as an interval. */
export async function GET(request: NextRequest) {
  try {
    await requireMesSyncAccess();
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) return NextResponse.json({ success: false, error: "jobId가 필요합니다." }, { status: 400 });
    const supabase = await createClient();
    const { data, error } = await supabase.from("automation_jobs")
      .select("id, status, progress_stage, progress_percent, error_code, error_message, result_code, updated_at")
      .eq("id", jobId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: "작업을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ success: true, job: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "작업 상태 조회 실패" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { session, supabase } = await requireMesSyncAccess();
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) return NextResponse.json({ success: false, error: "jobId가 필요합니다." }, { status: 400 });
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("automation_jobs")
      .update({ status: "CANCEL_REQUESTED", cancel_requested_at: now, updated_at: now })
      .eq("id", jobId).eq("requested_by", Number(session.userId)).in("status", ["PENDING", "RUNNING"])
      .select("id, status").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ success: false, error: "중단할 작업이 없거나 권한이 없습니다." }, { status: 409 });
    return NextResponse.json({ success: true, job: data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "취소 요청 실패" }, { status: 500 });
  }
}
