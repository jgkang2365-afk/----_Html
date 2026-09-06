import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** 수동 재검증은 업로드가 아닌 별도 read-only 큐에만 등록한다. */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const body = await request.json();
    const resultDate = String(body.resultDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) return NextResponse.json({ error: "검증일은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    const session = await getSession();
    // 권한 확인 후에만 service-role 서버 클라이언트로 제한 RPC를 호출한다.
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("enqueue_k2b_verify_job", { p_result_date: resultDate, p_requested_by: session?.userId ?? null });
    if (error) {
      const status = error.message.includes("ALREADY_ACTIVE") ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ jobId: data, message: "K2B 읽기 전용 재검증을 대기열에 등록했습니다." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "K2B 재검증 등록 실패" }, { status: 500 });
  }
}
