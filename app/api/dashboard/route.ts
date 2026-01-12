import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET() {
  try {
    // 권한 확인
    await checkPermission("dashboard:read");

    const supabase = await createClient();

    // 1. 측정건수 및 미완료 건수
    const { data: allJournals, error: journalError } = await supabase
      .from("measurement_journal")
      .select("id, completion_status");

    if (journalError) {
      console.error("측정일지 조회 오류:", journalError);
      throw journalError;
    }

    const totalCount = allJournals?.length || 0;
    const incompleteCount =
      allJournals?.filter((j) => j.completion_status === "미완료").length || 0;

    // 2. 측정완료일 기준 25일 경과 사업장 목록
    const today = new Date();
    const twentyFiveDaysAgo = new Date(today);
    twentyFiveDaysAgo.setDate(today.getDate() - 25);

    const { data: overdueBusinesses, error: overdueError } = await supabase
      .from("measurement_journal")
      .select("id, business_name, completion_date, designated_office")
      .eq("completion_status", "완료")
      .not("completion_date", "is", null)
      .lte("completion_date", twentyFiveDaysAgo.toISOString().split("T")[0])
      .order("completion_date", { ascending: true });

    if (overdueError) {
      console.error("25일 경과 사업장 조회 오류:", overdueError);
    }

    // 경과일수 계산
    const overdueList =
      overdueBusinesses?.map((business) => {
        const completionDate = new Date(business.completion_date);
        const daysDiff = Math.floor(
          (today.getTime() - completionDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        return {
          ...business,
          days_overdue: daysDiff,
        };
      }) || [];

    // 3. 지정한계_관할지청별 사업장 수
    const { data: officeStats, error: officeError } = await supabase
      .from("measurement_journal")
      .select("designated_office")
      .not("designated_office", "is", null);

    if (officeError) {
      console.error("관할지청별 통계 조회 오류:", officeError);
    }

    const officeCountMap: Record<string, number> = {};
    officeStats?.forEach((item) => {
      const office = item.designated_office || "미지정";
      officeCountMap[office] = (officeCountMap[office] || 0) + 1;
    });

    const officeStatsList = Object.entries(officeCountMap)
      .map(([office, count]) => ({
        office,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // 4. 매출현황 (측정비/기타매출 분리)
    const { data: revenueData, error: revenueError } = await supabase
      .from("measurement_journal")
      .select("measurement_fee_total, measurement_fee_business, measurement_fee_national");

    if (revenueError) {
      console.error("매출현황 조회 오류:", revenueError);
    }

    let totalMeasurementFee = 0;
    let totalOtherRevenue = 0;

    revenueData?.forEach((item) => {
      const measurementFee =
        parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      totalMeasurementFee += measurementFee;
      // 기타매출은 별도 필드가 없으므로 0으로 설정 (추후 확장 가능)
      totalOtherRevenue += 0;
    });

    // 5. 년도별/월별 매출 추이
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
      const year = item.measurement_year;
      const fee = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;

      // 년도별 집계
      yearlyRevenue[year] = (yearlyRevenue[year] || 0) + fee;

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
      .slice(0, 12); // 최근 12개월

    // 6. 미수관리 (사업장별 집계)
    const { data: unpaidData, error: unpaidError } = await supabase
      .from("measurement_journal")
      .select(
        "id, business_name, measurement_fee_total, measurement_fee_business, measurement_fee_national, deposit_total"
      )
      .not("measurement_fee_total", "is", null);

    if (unpaidError) {
      console.error("미수관리 조회 오류:", unpaidError);
    }

    // 사업장별로 집계
    const businessUnpaidMap: Record<string, {
      business_name: string;
      measurement_fee_total: number;
      measurement_fee_business: number;
      measurement_fee_national: number;
      unpaid_count: number;
      unpaid_total: number;
    }> = {};

    unpaidData?.forEach((item) => {
      const feeTotal = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const feeBusiness = parseFloat(item.measurement_fee_business?.toString() || "0") || 0;
      const feeNational = parseFloat(item.measurement_fee_national?.toString() || "0") || 0;
      const depositTotal = parseFloat(item.deposit_total?.toString() || "0") || 0;
      const unpaidAmount = feeTotal - depositTotal;

      // 미수금액이 있는 경우만 집계
      if (unpaidAmount > 0) {
        const businessName = item.business_name || "미지정";
        
        if (!businessUnpaidMap[businessName]) {
          businessUnpaidMap[businessName] = {
            business_name: businessName,
            measurement_fee_total: 0,
            measurement_fee_business: 0,
            measurement_fee_national: 0,
            unpaid_count: 0,
            unpaid_total: 0,
          };
        }

        businessUnpaidMap[businessName].measurement_fee_total += feeTotal;
        businessUnpaidMap[businessName].measurement_fee_business += feeBusiness;
        businessUnpaidMap[businessName].measurement_fee_national += feeNational;
        businessUnpaidMap[businessName].unpaid_count += 1;
        businessUnpaidMap[businessName].unpaid_total += unpaidAmount;
      }
    });

    // 배열로 변환 및 정렬 (미수금액 합계 기준 내림차순)
    const unpaidList = Object.values(businessUnpaidMap)
      .sort((a, b) => b.unpaid_total - a.unpaid_total);

    // 미수 총 금액 및 건수
    const totalUnpaidAmount = unpaidList.reduce(
      (sum, item) => sum + item.unpaid_total,
      0
    );
    const unpaidCount = unpaidList.length;

    return NextResponse.json({
      // 측정건수 및 미완료 건수
      totalCount,
      incompleteCount,
      completeCount: totalCount - incompleteCount,

      // 25일 경과 사업장 목록
      overdueBusinesses: overdueList,

      // 지정한계_관할지청별 사업장 수
      officeStats: officeStatsList,

      // 매출현황
      revenue: {
        measurementFee: totalMeasurementFee,
        otherRevenue: totalOtherRevenue,
        total: totalMeasurementFee + totalOtherRevenue,
      },

      // 년도별/월별 매출 추이
      revenueTrend: {
        yearly: yearlyRevenueList,
        monthly: monthlyRevenueList,
      },

      // 미수관리
      unpaid: {
        list: unpaidList,
        totalAmount: totalUnpaidAmount,
        count: unpaidCount,
      },
    });
  } catch (error: any) {
    console.error("대시보드 데이터 조회 오류:", error);
    return NextResponse.json(
      {
        error: "대시보드 데이터를 불러오는 중 오류가 발생했습니다.",
        details: error.message,
      },
      { status: error.status || 500 }
    );
  }
}
