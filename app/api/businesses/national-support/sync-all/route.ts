import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 건강디딤돌 신청결과 → 측정 대상 사업장 일괄 동기화 API
 * POST /api/businesses/national-support/sync-all
 *
 * national_support_application 테이블의 결과를
 * measurement_target_business의 national_support_status에 일괄 반영합니다.
 */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    const supabase = await createClient();

    // 1. 동기화 대상 national_support_application 전체 조회 (Bulk)
    let appQuery = supabase
      .from("national_support_application")
      .select("code, year, period, national_support_status")
      .not("national_support_status", "is", null);

    if (year) appQuery = appQuery.eq("year", parseInt(year));
    if (period) appQuery = appQuery.eq("period", period);

    const { data: applications, error: appError } = await appQuery;

    if (appError) {
      return NextResponse.json(
        { error: "건강디딤돌 신청결과 조회 실패: " + appError.message },
        { status: 500 }
      );
    }

    if (!applications || applications.length === 0) {
      return NextResponse.json({
        success: true,
        synced: 0,
        message: "동기화할 데이터가 없습니다.",
      });
    }

    // 2. 국고지원 상태값 정규화 ("지원" → "대상", "비대상" → "비대상")
    const normalizeStatus = (status: string | null): "대상" | "비대상" => {
      if (status === "지원" || status === "대상" || status === "지원대상") return "대상";
      return "비대상";
    };

    // 3. 일괄 업데이트 (code+year+period 매칭)
    let syncedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Promise.all로 병렬 처리 (최대 20개씩 배치)
    const BATCH_SIZE = 20;
    for (let i = 0; i < applications.length; i += BATCH_SIZE) {
      const batch = applications.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (app: any) => {
          const targetStatus = normalizeStatus(app.national_support_status);

          const { error } = await supabase
            .from("measurement_target_business")
            .update({
              national_support_status: targetStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("code", app.code)
            .eq("year", app.year)
            .eq("period", app.period);

          if (error) {
            failedCount++;
            errors.push(`${app.code} (${app.year} ${app.period}): ${error.message}`);
          } else {
            syncedCount++;
          }
        })
      );
    }

    return NextResponse.json({
      success: true,
      synced: syncedCount,
      failed: failedCount,
      message: `${syncedCount}건 동기화 완료${failedCount > 0 ? `, ${failedCount}건 실패` : ""}`,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error: any) {
    console.error("일괄 동기화 API 오류:", error);
    return NextResponse.json(
      { error: error.message || "일괄 동기화 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
