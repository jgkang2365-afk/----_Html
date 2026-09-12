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
    // The MES lane is deliberately global.  Do not expose a scheduled or
    // another user's active job as if it belonged to this request.
    if (job.requested_by !== Number(session.userId)) {
      return NextResponse.json({ success: false, error: "다른 MES 동기화 작업이 진행 중입니다." }, { status: 409 });
    }
    return NextResponse.json({ success: true, job }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    const message = error?.message || "동기화 요청에 실패했습니다.";
    return NextResponse.json({ success: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
