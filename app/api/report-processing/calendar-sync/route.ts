import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";
import { syncBusinessToCalendar } from "@/lib/google/sync-service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorizedDocumentWorker(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code, year, period } = await request.json();
    if (!code || !year || !period) {
      return NextResponse.json(
        { success: false, error: "code, year, period가 필요합니다." },
        { status: 400 },
      );
    }

    // period는 전송 안전값("first"/"second")으로 들어온다. 내부 DB 값으로 변환한다.
    const measurementPeriod =
      period === "first"
        ? "상반기"
        : period === "second"
          ? "하반기"
          : null;
    if (measurementPeriod == null) {
      return NextResponse.json(
        { success: false, error: `지원하지 않는 period 값입니다: ${String(period)}` },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: journal, error: journalError } = await supabase
      .from("measurement_journal")
      .select("k2b_status, k2b_send_date")
      .eq("code", code)
      .eq("measurement_year", year)
      .eq("measurement_period", measurementPeriod)
      .maybeSingle();

    if (journalError) throw journalError;
    console.log(
      `[K2B Calendar Sync API Trace] code=${code} year=${year} period=${period} measurementPeriod=${measurementPeriod} ` +
      `journal=${journal ? 'present' : 'missing'} ` +
      `status=${JSON.stringify(journal?.k2b_status)} ` +
      `sendDate=${JSON.stringify(journal?.k2b_send_date)}`
    );
    if (!journal || journal.k2b_status !== "정상처리" || !journal.k2b_send_date) {
      return NextResponse.json(
        { success: false, error: "K2B 최종 정상처리가 DB에 반영되지 않았습니다." },
        { status: 409 },
      );
    }

    const result = await syncBusinessToCalendar(supabase, code, year, measurementPeriod);
    if (!result?.success) {
      throw new Error("캘린더 동기화 결과를 확인하지 못했습니다.");
    }

    return NextResponse.json({
      success: true,
      count: result.count,
      syncedEventCount: result.syncedEventCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[K2B Calendar Sync API] 실패:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
