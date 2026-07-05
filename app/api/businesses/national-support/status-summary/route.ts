import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 국고 일괄 처리를 위한 통계 요약 및 미완료 목록 조회 API
 * GET /api/businesses/national-support/status-summary
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 검증 (일지 작성 권한이 있는 사용자 이상만 허용)
    await checkPermission("journal:write");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    if (!year || !period) {
      return NextResponse.json(
        { error: "년도(year)와 주기(period) 파라미터가 누락되었습니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 년도와 주기에 매칭되는 전체 대상 사업장 데이터 조회
    const { data: allTargets, error: queryError } = await supabase
      .from("measurement_target_business")
      .select(`
        id,
        code,
        business_name,
        sync_status,
        national_support_status,
        industrial_accident_number,
        sanjae,
        commencement_number,
        commencement,
        representative_name,
        manager_name,
        manager_mobile,
        period,
        year
      `)
      .eq("year", parseInt(year))
      .eq("period", period);

    if (queryError) {
      console.error("국고 일괄 조회 통계 수집 실패:", queryError);
      return NextResponse.json(
        { error: "대상 사업장 목록을 조회하는 데 실패했습니다." },
        { status: 500 }
      );
    }

    const total = allTargets.length;
    const success = allTargets.filter((t) => t.sync_status === "성공").length;
    const pending = allTargets.filter((t) => t.sync_status === "신청중" || t.sync_status === "조회중").length;
    const failed = allTargets.filter((t) => t.sync_status === "실패").length;
    
    // 일괄 처리(조회)가 가능한 유효 대상 필터링
    // (성공이 아니고, 수시 주기가 아니며, 필수 정보(산재번호, 개시번호, 대표자명)가 채워진 대상)
    const queue = allTargets.filter((t) => {
      const sanjaeVal = t.industrial_accident_number || t.sanjae;
      const commencementVal = t.commencement_number || t.commencement;
      const representativeVal = t.representative_name;
      const isCompleted = t.sync_status === "성공";
      const isPending = t.sync_status === "신청중" || t.sync_status === "조회중";
      const isSusi = t.period && t.period.includes("(수시)");
      
      return sanjaeVal && commencementVal && representativeVal && !isCompleted && !isPending && !isSusi;
    });

    return NextResponse.json({
      success: true,
      stats: {
        total,
        success,
        pending,
        failed,
        queueCount: queue.length,
      },
      queue: queue.map((t) => ({
        id: t.id,
        code: t.code,
        business_name: t.business_name,
        sanjae: t.industrial_accident_number || t.sanjae,
        commencement: t.commencement_number || t.commencement,
        representative: t.representative_name,
        manager_name: t.manager_name,
        manager_mobile: t.manager_mobile,
        period: t.period,
        year: t.year,
      })),
    });
  } catch (error: any) {
    console.error("국고 통계 요약 API 내부 오류:", error);
    return NextResponse.json(
      { error: error.message || "통계 요약 수집 중 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
