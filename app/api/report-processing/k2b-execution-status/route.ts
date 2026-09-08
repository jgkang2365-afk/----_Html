import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { toK2BExecutionStatus } from "@/lib/report-processing/k2b-execution-status";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** 최근 K2B 실제결과 검증 작업의 관측된 사실만 반환한다. */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");
    const supabase = await createClient();
    const requestedJobId = new URL(request.url).searchParams.get("id");
    if (requestedJobId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedJobId)) {
      return NextResponse.json({ error: "K2B Run ID 형식이 올바르지 않습니다." }, { status: 400 });
    }
    let query = supabase
      .from("background_jobs")
      .select("id, status, payload, error_message, created_at, started_at, finished_at, execution_result")
      .in("job_type", ["k2b_original_sync", "k2b_verify"]);
    query = requestedJobId
      ? query.eq("id", requestedJobId)
      : query.order("created_at", { ascending: false }).limit(1);
    const { data: job, error } = await query.maybeSingle();
    if (error) throw error;
    if (!job) {
      return NextResponse.json({ execution: null }, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    return NextResponse.json({
      execution: toK2BExecutionStatus(job),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "K2B 실행상태 조회에 실패했습니다.";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
