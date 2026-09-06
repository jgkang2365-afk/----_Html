import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const MAX_PILOT_JOURNALS = 20;

/**
 * Staging용 사전 점검 경로: K2B에 접속하지 않고 최대 20건의 로컬 후보 수만
 * 확인한다. 실제 K2B read-only 검증은 별도 명시적 수동 enqueue 이후에만 수행된다.
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const resultDate = new URL(request.url).searchParams.get("resultDate") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) return NextResponse.json({ error: "검증일은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    const supabase = await createClient();
    const { data, error } = await supabase.from("measurement_journal")
      .select("id, code, business_name, k2b_send_date, k2b_status")
      .eq("k2b_send_date", resultDate).order("id", { ascending: true }).limit(MAX_PILOT_JOURNALS);
    if (error) throw error;
    return NextResponse.json({
      mode: "STAGING_READ_ONLY_PILOT_PRECHECK",
      resultDate,
      maxCandidates: MAX_PILOT_JOURNALS,
      candidateCount: data?.length || 0,
      remoteK2BReadExecuted: false,
      nextStep: "승인된 staging 계정으로 수동 재검증을 enqueue하면 headless read-only K2B 검증이 실행됩니다.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "pilot 사전 점검 실패" }, { status: 500 });
  }
}
