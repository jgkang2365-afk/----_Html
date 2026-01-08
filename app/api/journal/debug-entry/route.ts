import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 측정일지 엔트리 디버깅 API
 * GET /api/journal/debug-entry?code=XXX&year=2024&period=상반기
 * 엔트리에 포함된 모든 데이터를 확인할 수 있습니다.
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    if (!code || !year || !period) {
      return NextResponse.json(
        { error: "code, year, period 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // measurement_business 조회
    const { data: businessData, error: businessError } = await supabase
      .from("measurement_business")
      .select("*")
      .eq("code", code)
      .eq("year", parseInt(year))
      .eq("period", period)
      .maybeSingle();

    // business_info 조회
    const { data: businessInfo, error: businessInfoError } = await supabase
      .from("business_info")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    // measurement_journal 조회
    const { data: journalData, error: journalError } = await supabase
      .from("measurement_journal")
      .select("*")
      .eq("code", code)
      .eq("measurement_year", parseInt(year))
      .eq("measurement_period", period)
      .maybeSingle();

    return NextResponse.json({
      code,
      year,
      period,
      measurement_business: businessData || null,
      business_info: businessInfo || null,
      measurement_journal: journalData || null,
      errors: {
        business: businessError?.message || null,
        businessInfo: businessInfoError?.message || null,
        journal: journalError?.message || null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "디버깅 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
