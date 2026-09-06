import { NextRequest, NextResponse } from "next/server";
import { enqueueSerializedK2BUpload } from "@/lib/automation/k2b-job-queue";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 이전 직접 업로드 URL의 호환 진입점이다.
 * 브라우저 자동화는 여기서 실행하지 않고 WorkerDaemon queue에만 등록한다.
 */
export async function POST(req: NextRequest) {
  try {
    await checkPermission("journal:write");
    const { targets } = await req.json();
    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: "대상 업체가 없습니다." }, { status: 400 });
    }

    const session = await getSession();
    if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const supabase = createAdminClient();
    const { data: dbUser, error: userError } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", session.userId)
      .single();
    if (userError) throw userError;

    const requestUser = dbUser
      ? { id: dbUser.id, name: dbUser.name }
      : { id: session.userId, name: "알 수 없음" };
    const jobId = await enqueueSerializedK2BUpload(supabase, {
      targets,
      requestUser,
      calendarSyncApiUrl: new URL("/api/report-processing/calendar-sync", req.url).toString(),
    });

    return NextResponse.json({
      message: "K2B 업로드를 백그라운드 작업 큐에 등록했습니다.",
      jobId,
    }, { status: 202 });
  } catch (error: unknown) {
    console.error("[K2B API Error]", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "K2B 처리 중 오류 발생",
    }, { status: 500 });
  }
}
