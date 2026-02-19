import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET() {
  try {
    console.log("[API /api/dashboard/sample] 샘플 대시보드 데이터 조회 시작");

    // 환경 변수 확인
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error("[API /api/dashboard/sample] Supabase 환경 변수가 설정되지 않았습니다.");
      return NextResponse.json(
        {
          error: "서버 설정 오류",
          details: "Supabase 환경 변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.",
        },
        { status: 500 }
      );
    }

    // 권한 확인
    try {
      await checkPermission("dashboard:read");
      console.log("[API /api/dashboard/sample] 권한 확인 완료");
    } catch (permissionError: any) {
      console.error("[API /api/dashboard/sample] 권한 확인 실패:", permissionError);
      console.error("[API /api/dashboard/sample] 권한 오류 타입:", typeof permissionError);
      console.error("[API /api/dashboard/sample] 권한 오류 메시지:", permissionError?.message);
      console.error("[API /api/dashboard/sample] 권한 오류 스택:", permissionError?.stack);

      if (permissionError?.message === "Unauthorized") {
        return NextResponse.json(
          { error: "로그인이 필요합니다.", details: permissionError.message },
          { status: 401 }
        );
      }
      if (permissionError?.message === "Forbidden") {
        return NextResponse.json(
          { error: "권한이 없습니다.", details: permissionError.message },
          { status: 403 }
        );
      }
      // 예상치 못한 권한 오류
      return NextResponse.json(
        {
          error: "권한 확인 중 오류가 발생했습니다.",
          details: permissionError?.message || String(permissionError),
        },
        { status: 500 }
      );
    }

    console.log("[API /api/dashboard/sample] Supabase 클라이언트 생성 시작");
    let supabase;
    try {
      supabase = await createClient();
      console.log("[API /api/dashboard/sample] Supabase 클라이언트 생성 완료");
    } catch (supabaseError: any) {
      console.error("[API /api/dashboard/sample] Supabase 클라이언트 생성 실패:", supabaseError);
      return NextResponse.json(
        {
          error: "데이터베이스 연결 오류",
          details: supabaseError?.message || "Supabase 클라이언트를 생성할 수 없습니다.",
        },
        { status: 500 }
      );
    }

    // 1. 측정건수 및 미완료 건수
    console.log("[API /api/dashboard/sample] 측정일지 조회 시작");
    const { data: allJournals, error: journalError } = await supabase
      .from("measurement_journal")
      .select("id, completion_status");

    if (journalError) {
      console.error("[API /api/dashboard/sample] 측정일지 조회 오류:", journalError);
      console.error("[API /api/dashboard/sample] 측정일지 조회 오류 코드:", journalError.code);
      console.error("[API /api/dashboard/sample] 측정일지 조회 오류 메시지:", journalError.message);
      return NextResponse.json(
        {
          error: "측정일지 데이터 조회 실패",
          details: journalError.message || "데이터베이스에서 측정일지를 조회하는 중 오류가 발생했습니다.",
        },
        { status: 500 }
      );
    }
    console.log("[API /api/dashboard/sample] 측정일지 조회 완료:", allJournals?.length || 0, "건");

    const totalCount = allJournals?.length || 0;
    const incompleteCount =
      allJournals?.filter((j) => j.completion_status === "미완료").length || 0;
    const completeCount = totalCount - incompleteCount;

    // 2. 매출현황 (측정비/기타매출 분리)
    const { data: revenueData, error: revenueError } = await supabase
      .from("measurement_journal")
      .select("measurement_fee_total, measurement_fee_business, measurement_fee_national, deposit_total");

    if (revenueError) {
      console.error("매출현황 조회 오류:", revenueError);
    }

    let totalMeasurementFee = 0;
    let totalDeposit = 0;

    revenueData?.forEach((item) => {
      const measurementFee =
        parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
      totalMeasurementFee += measurementFee;
      totalDeposit += deposit;
    });

    // 기타 매출 조회 (other_revenue 테이블)
    let totalOtherRevenue = 0;
    try {
      const { data: otherRevenueData, error: otherRevenueError } = await supabase
        .from("other_revenue")
        .select("total_amount");

      if (otherRevenueError) {
        console.error("기타 매출 조회 오류:", otherRevenueError);
      } else {
        otherRevenueData?.forEach((item) => {
          const amount = parseFloat(item.total_amount?.toString() || "0") || 0;
          totalOtherRevenue += amount;
        });
      }
    } catch (err) {
      console.error("기타 매출 조회 예외:", err);
    }

    // 3. 완료율 계산
    const completionRate = totalCount > 0 ? (completeCount / totalCount) * 100 : 0;

    // 4. 입금률 계산
    const depositRate = totalMeasurementFee > 0 ? (totalDeposit / totalMeasurementFee) * 100 : 0;

    // 5. 측정주기별 통계
    const { data: periodData, error: periodError } = await supabase
      .from("measurement_journal")
      .select("measurement_period, completion_status");

    if (periodError) {
      console.error("측정주기별 통계 조회 오류:", periodError);
    }

    const periodStats: Record<string, { total: number; complete: number; incomplete: number }> = {
      상반기: { total: 0, complete: 0, incomplete: 0 },
      하반기: { total: 0, complete: 0, incomplete: 0 },
    };

    periodData?.forEach((item) => {
      const period = item.measurement_period || "미지정";
      if (period === "상반기" || period === "하반기") {
        periodStats[period].total += 1;
        if (item.completion_status === "완료") {
          periodStats[period].complete += 1;
        } else {
          periodStats[period].incomplete += 1;
        }
      }
    });

    // 6. 국고지원 현황
    const { data: nationalSupportData, error: nationalSupportError } = await supabase
      .from("measurement_journal")
      .select("national_support_status")
      .not("national_support_status", "is", null);

    if (nationalSupportError) {
      console.error("국고지원 현황 조회 오류:", nationalSupportError);
    }

    const nationalSupportStats = {
      지원: nationalSupportData?.filter((item) => item.national_support_status === "지원").length || 0,
      비대상: nationalSupportData?.filter((item) => item.national_support_status === "비대상").length || 0,
      전체: nationalSupportData?.length || 0,
    };

    // 7. 최근 측정 활동 (최근 7일간 생성/완료된 측정일지)
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const { data: recentActivity, error: recentActivityError } = await supabase
      .from("measurement_journal")
      .select("id, business_name, completion_status, created_at, updated_at")
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentActivityError) {
      console.error("최근 활동 조회 오류:", recentActivityError);
    }

    // 8. K2B 전송 현황
    const { data: k2bData, error: k2bError } = await supabase
      .from("measurement_journal")
      .select("id, k2b_send_date")
      .not("k2b_send_date", "is", null);

    if (k2bError) {
      console.error("K2B 전송 현황 조회 오류:", k2bError);
    }

    const k2bStats = {
      전송완료: k2bData?.length || 0,
      미전송: totalCount - (k2bData?.length || 0),
    };

    // 9. 연도/주기별 측정건수 추이
    const { data: countTrendData, error: countTrendError } = await supabase
      .from("measurement_journal")
      .select("measurement_year, measurement_period");

    if (countTrendError) {
      console.error("측정건수 추이 조회 오류:", countTrendError);
    }

    const countTrendMap: Record<string, number> = {};
    countTrendData?.forEach((item) => {
      if (item.measurement_year && item.measurement_period) {
        const key = `${item.measurement_year}-${item.measurement_period}`;
        countTrendMap[key] = (countTrendMap[key] || 0) + 1;
      }
    });

    const countTrendList = Object.entries(countTrendMap)
      .map(([key, count]) => {
        const [year, period] = key.split("-");
        return {
          year: parseInt(year),
          period,
          count,
        };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return a.period === "상반기" ? -1 : 1;
      });

    // 10. 평균 측정 기간 계산
    const { data: measurementPeriodData, error: measurementPeriodError } = await supabase
      .from("measurement_journal")
      .select("measurement_start_date, measurement_end_date")
      .not("measurement_start_date", "is", null)
      .not("measurement_end_date", "is", null);

    if (measurementPeriodError) {
      console.error("측정 기간 조회 오류:", measurementPeriodError);
    }

    let totalDays = 0;
    let validPeriodCount = 0;
    measurementPeriodData?.forEach((item) => {
      const startDate = new Date(item.measurement_start_date);
      const endDate = new Date(item.measurement_end_date);
      const days = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (days > 0) {
        totalDays += days;
        validPeriodCount += 1;
      }
    });

    const averageMeasurementDays = validPeriodCount > 0 ? Math.round(totalDays / validPeriodCount) : 0;

    // 11. 년도별/월별 매출 추이 (현재 + 이전 년도)
    const { data: monthlyRevenue, error: monthlyError } = await supabase
      .from("measurement_journal")
      .select("measurement_year, measurement_period, measurement_fee_total, created_at")
      .not("measurement_fee_total", "is", null)
      .order("measurement_year", { ascending: false })
      .order("created_at", { ascending: false });

    if (monthlyError) {
      console.error("월별 매출 추이 조회 오류:", monthlyError);
    }

    // 년도별 집계
    const yearlyRevenue: Record<number, number> = {};
    // 월별 집계 (YYYY-MM 형식)
    const monthlyRevenueMap: Record<string, number> = {};

    monthlyRevenue?.forEach((item) => {
      const itemYear = item.measurement_year;
      if (!itemYear) return;
      const fee = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;

      // 년도별 집계
      yearlyRevenue[itemYear] = (yearlyRevenue[itemYear] || 0) + fee;

      // 월별 집계
      if (item.created_at) {
        const date = new Date(item.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        monthlyRevenueMap[monthKey] = (monthlyRevenueMap[monthKey] || 0) + fee;
      }
    });

    const yearlyRevenueList = Object.entries(yearlyRevenue)
      .map(([year, amount]) => ({
        year: parseInt(year),
        amount,
      }))
      .sort((a, b) => b.year - a.year);

    const monthlyRevenueList = Object.entries(monthlyRevenueMap)
      .map(([month, amount]) => ({
        month,
        amount,
      }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12);

    // 12. 지정지청별 매출 현황 (현재 + 이전 년도)
    const { data: officeRevenueData, error: officeRevenueError } = await supabase
      .from("measurement_journal")
      .select("designated_office, measurement_fee_total, measurement_year")
      .not("measurement_fee_total", "is", null)
      .not("designated_office", "is", null);

    if (officeRevenueError) {
      console.error("지정지청별 매출 조회 오류:", officeRevenueError);
    }

    const officeRevenueMap: Record<string, number> = {};

    officeRevenueData?.forEach((item) => {
      const office = item.designated_office || "미지정";
      const fee = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      officeRevenueMap[office] = (officeRevenueMap[office] || 0) + fee;
    });

    const officeRevenueList = Object.entries(officeRevenueMap)
      .map(([office, amount]) => ({
        office,
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);

    // 13. 측정주기별 매출 현황
    const { data: periodRevenueData, error: periodRevenueError } = await supabase
      .from("measurement_journal")
      .select("measurement_period, measurement_fee_total")
      .not("measurement_fee_total", "is", null);

    if (periodRevenueError) {
      console.error("측정주기별 매출 조회 오류:", periodRevenueError);
    }

    const periodRevenueMap: Record<string, number> = {
      상반기: 0,
      하반기: 0,
    };

    periodRevenueData?.forEach((item) => {
      const period = item.measurement_period || "미지정";
      if (period === "상반기" || period === "하반기") {
        const fee = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
        periodRevenueMap[period] = (periodRevenueMap[period] || 0) + fee;
      }
    });

    const periodRevenueList = Object.entries(periodRevenueMap)
      .map(([period, amount]) => ({
        period,
        amount,
      }))
      .sort((a, b) => {
        if (a.period === "상반기") return -1;
        if (b.period === "상반기") return 1;
        return 0;
      });

    return NextResponse.json({
      // 측정건수 및 미완료 건수
      totalCount,
      incompleteCount,
      completeCount,
      completionRate: Math.round(completionRate * 10) / 10,

      // 매출현황
      revenue: {
        measurementFee: totalMeasurementFee,
        otherRevenue: totalOtherRevenue,
        total: totalMeasurementFee + totalOtherRevenue,
        deposit: totalDeposit,
        depositRate: Math.round(depositRate * 10) / 10,
      },

      // 측정주기별 통계
      periodStats: periodStats,

      // 국고지원 현황
      nationalSupport: nationalSupportStats,

      // 최근 측정 활동
      recentActivity: recentActivity?.map((item) => ({
        id: item.id,
        business_name: item.business_name,
        completion_status: item.completion_status,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })) || [],

      // K2B 전송 현황
      k2bStats: k2bStats,

      // 연도/주기별 측정건수 추이
      countTrend: countTrendList,

      // 평균 측정 기간
      averageMeasurementDays: averageMeasurementDays,

      // 년도별/월별 매출 추이
      revenueTrend: {
        yearly: yearlyRevenueList,
        monthly: monthlyRevenueList,
      },

      // 지정지청별 매출 현황
      officeRevenue: officeRevenueList,

      // 측정주기별 매출 현황
      periodRevenue: periodRevenueList,
    });
  } catch (error: any) {
    console.error("[API /api/dashboard/sample] ===== 예외 발생 =====");
    console.error("[API /api/dashboard/sample] 오류 타입:", typeof error);
    console.error("[API /api/dashboard/sample] 오류 이름:", error?.name);
    console.error("[API /api/dashboard/sample] 오류 메시지:", error?.message);
    console.error("[API /api/dashboard/sample] 오류 스택:", error?.stack);

    // Supabase 에러인 경우
    if (error?.code || error?.hint || error?.details) {
      console.error("[API /api/dashboard/sample] Supabase 에러 상세:", {
        code: error.code,
        message: error.message,
        hint: error.hint,
        details: error.details,
      });
    }

    const errorMessage = error?.message || "알 수 없는 오류";
    const errorDetails = error?.details || error?.hint || errorMessage;

    // 권한 관련 에러인 경우
    if (error?.message === "Unauthorized") {
      return NextResponse.json(
        {
          error: "로그인이 필요합니다.",
          details: errorDetails,
        },
        { status: 401 }
      );
    }

    if (error?.message === "Forbidden") {
      return NextResponse.json(
        {
          error: "권한이 없습니다.",
          details: errorDetails,
        },
        { status: 403 }
      );
    }

    // 일반적인 에러 응답
    return NextResponse.json(
      {
        error: "샘플 대시보드 데이터를 불러오는 중 오류가 발생했습니다.",
        details: errorDetails,
        message: errorMessage,
        // 개발 환경에서만 추가 정보 포함
        ...(process.env.NODE_ENV === "development" && {
          code: error?.code,
          hint: error?.hint,
          stack: error?.stack?.substring(0, 500), // 스택 트레이스 일부만 포함
        }),
      },
      { status: error?.status || 500 }
    );
  }
}
