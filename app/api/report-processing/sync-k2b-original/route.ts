import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminK2BVerificationRange } from "@/lib/automation/k2b-original-sync";

export const dynamic = "force-dynamic";

/** 기존 verify-k2b 단일일 계약과 분리된, 명시적 기간의 수동 K2B 원본 동기화 endpoint. */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const body = await request.json();
    const fromDate = String(body.fromDate ?? "");
    const toDate = String(body.toDate ?? "");
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: "수동 K2B 원본 동기화 요청자를 확인할 수 없습니다." }, { status: 401 });
    if (session.role !== "관리자") return NextResponse.json({ error: "관리자만 K2B 직접 기간 재검증을 요청할 수 있습니다." }, { status: 403 });
    try { assertAdminK2BVerificationRange(fromDate, toDate); } catch { return NextResponse.json({ error: "조회 기간은 YYYY-MM-DD 형식이며 최대 31일이어야 합니다." }, { status: 400 }); }
    const { data, error } = await createAdminClient().rpc("enqueue_k2b_original_sync_job", { p_payload: {
      trigger: "manual", requestedBy: session.userId, fromDate, toDate, cursorEligible: false, serializationDisposition: "accepted_without_active_k2b",
    } });
    if (error) return NextResponse.json({ error: error.message }, { status: error.message.includes("ALREADY_ACTIVE") ? 409 : 500 });
    return NextResponse.json({ jobId: data, range: { fromDate, toDate }, message: "K2B 원본 동기화를 대기열에 등록했습니다." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "K2B 원본 동기화 등록 실패" }, { status: 500 }); }
}
