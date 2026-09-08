import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** 기존 verify-k2b 단일일 계약과 분리된, 명시적 기간의 수동 K2B 원본 동기화 endpoint. */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const body = await request.json();
    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) return NextResponse.json({ error: "조회 기간은 YYYY-MM-DD 형식의 from/to여야 합니다." }, { status: 400 });
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: "수동 K2B 원본 동기화 요청자를 확인할 수 없습니다." }, { status: 401 });
    const { data, error } = await createAdminClient().rpc("enqueue_k2b_original_sync_job", { p_payload: {
      trigger: "manual", requestedBy: session.userId, fromDate, toDate, cursorEligible: false, serializationDisposition: "accepted_without_active_k2b",
    } });
    if (error) return NextResponse.json({ error: error.message }, { status: error.message.includes("ALREADY_ACTIVE") ? 409 : 500 });
    return NextResponse.json({ jobId: data, range: { fromDate, toDate }, message: "K2B 원본 동기화를 대기열에 등록했습니다." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "K2B 원본 동기화 등록 실패" }, { status: 500 }); }
}
