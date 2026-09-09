import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getKSTDateString } from "@/lib/utils/date-utils";
import { assertAdminK2BVerificationRange, buildGeneralK2BVerificationRange } from "@/lib/automation/k2b-original-sync";

export const dynamic = "force-dynamic";

/** 수동 재검증은 업로드가 아닌 별도 read-only 큐에만 등록한다. */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const body: unknown = await request.json().catch(() => ({}));
    const requestedRange = body && typeof body === "object" && !Array.isArray(body)
      ? body as { fromDate?: unknown; toDate?: unknown }
      : {};
    const fromDate = typeof requestedRange.fromDate === "string" ? requestedRange.fromDate : "";
    const toDate = typeof requestedRange.toDate === "string" ? requestedRange.toDate : "";
    if (Boolean(fromDate) !== Boolean(toDate)) {
      return NextResponse.json({ error: "관리자 직접 기간은 시작일과 종료일을 함께 입력해야 합니다." }, { status: 400 });
    }
    // 일반 재검증은 client 날짜를 받지 않고 서버 KST 오늘 기준 최근 7 calendar days만 사용한다.
    const resultDate = getKSTDateString();
    const session = await getSession();
    const range = fromDate && toDate
      ? (() => {
        if (session?.role !== "관리자") throw new Error("ADMIN_RANGE_FORBIDDEN");
        return assertAdminK2BVerificationRange(fromDate, toDate);
      })()
      : buildGeneralK2BVerificationRange(resultDate);
    // 권한 확인 후에만 service-role 서버 클라이언트로 제한 RPC를 호출한다.
    const supabase = createAdminClient();
    const { data, error } = fromDate && toDate
      ? await supabase.rpc("enqueue_k2b_automation_job", {
        p_job_type: "k2b_verify",
        p_payload: {
          resultDate: range.toDate,
          requestedBy: session?.userId ?? null,
          fromDate: range.fromDate,
          toDate: range.toDate,
          trigger: "manual",
          serializationDisposition: "accepted_without_active_k2b",
        },
      })
      : await supabase.rpc("enqueue_k2b_verify_job", { p_result_date: resultDate, p_requested_by: session?.userId ?? null });
    if (error) {
      const status = error.message.includes("ALREADY_ACTIVE") ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ jobId: data, range, message: "최근 7일 K2B 실제결과 재검증을 대기열에 등록했습니다." });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_RANGE_FORBIDDEN") {
      return NextResponse.json({ error: "관리자만 K2B 직접 기간 재검증을 요청할 수 있습니다." }, { status: 403 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "K2B 재검증 등록 실패" }, { status: 500 });
  }
}
