import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET(request: NextRequest) {
  try {
    // 환경 변수 확인 및 권한 확인은 기존과 동일
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
    }

    try {
      await checkPermission("dashboard:read");
    } catch (permissionError: any) {
      if (permissionError?.message === "Unauthorized") return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      if (permissionError?.message === "Forbidden") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      return NextResponse.json({ error: "권한 확인 오류" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");
    const periodParam = searchParams.get("period");
    const targetYear = yearParam && yearParam !== "전체" && yearParam !== "" ? parseInt(yearParam) : null;
    const targetPeriod = periodParam && periodParam !== "전체" && periodParam !== "" ? periodParam.trim() : null;

    const supabase = await createClient();

    const applyFilters = (query: any, type: 'measurement' | 'other' = 'measurement') => {
      if (targetYear) query = query.eq(type === 'other' ? "revenue_year" : "measurement_year", targetYear);
      if (targetPeriod) query = query.ilike(type === 'other' ? "revenue_period" : "measurement_period", `%${targetPeriod}%`);
      return query;
    };

    // 1~8, 10, 12, 13번 데이터 조회 (기존 로직 유지)
    // -------------------------------------------------------------------------------- //
    // 1. 측정건수
    let q1 = supabase.from("measurement_journal").select("id, completion_status");
    q1 = applyFilters(q1, 'measurement');
    const { data: allJournals } = await q1;
    const totalCount = allJournals?.length || 0;
    const incompleteCount = allJournals?.filter((j) => j.completion_status === "미완료").length || 0;
    const completeCount = totalCount - incompleteCount;
    const completionRate = totalCount > 0 ? (completeCount / totalCount) * 100 : 0;

    // 2. 매출현황
    let q2 = supabase.from("measurement_journal").select("measurement_fee_total, measurement_fee_business, measurement_fee_national, deposit_total");
    q2 = applyFilters(q2, 'measurement');
    const { data: revenueData } = await q2;
    let totalMeasurementFee = 0;
    let totalDeposit = 0;
    revenueData?.forEach((item) => {
      totalMeasurementFee += parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      totalDeposit += parseFloat(item.deposit_total?.toString() || "0") || 0;
    });

    let totalOtherRevenue = 0;
    try {
      let qOther = supabase.from("other_revenue").select("total_amount");
      qOther = applyFilters(qOther, 'other');
      const { data: otherRevenueData } = await qOther;
      otherRevenueData?.forEach((item) => {
        totalOtherRevenue += parseFloat(item.total_amount?.toString() || "0") || 0;
      });
    } catch { }
    const depositRate = totalMeasurementFee > 0 ? (totalDeposit / totalMeasurementFee) * 100 : 0;

    // 5. 측정주기별 통계
    let q5 = supabase.from("measurement_journal").select("measurement_period, completion_status");
    q5 = applyFilters(q5, 'measurement');
    const { data: periodData } = await q5;
    const periodStats: Record<string, { total: number; complete: number; incomplete: number }> = {
      상반기: { total: 0, complete: 0, incomplete: 0 },
      하반기: { total: 0, complete: 0, incomplete: 0 },
    };
    periodData?.forEach((item) => {
      const period = item.measurement_period || "";
      const key = period.includes("상반기") ? "상반기" : (period.includes("하반기") ? "하반기" : null);
      if (key) {
        periodStats[key].total += 1;
        if (item.completion_status === "완료") periodStats[key].complete += 1;
        else periodStats[key].incomplete += 1;
      }
    });

    // 6. 국고지원 현황
    let q6 = supabase.from("measurement_journal").select("national_support_status").not("national_support_status", "is", null);
    q6 = applyFilters(q6, 'measurement');
    const { data: nationalSupportData } = await q6;
    const nationalSupportStats = {
      지원: nationalSupportData?.filter((item) => item.national_support_status === "지원").length || 0,
      비대상: nationalSupportData?.filter((item) => item.national_support_status === "비대상").length || 0,
      전체: nationalSupportData?.length || 0,
    };

    // 7. 측정 경과 일수 현황 (K2B 미전송 건 전체)
    // 조건: k2b_send_date IS NULL
    // 필터: measurement_end_date >= '2025-12-25' AND 경과일수 >= 20 (즉, end_date <= today - 20)
    const todayK2b = new Date();
    const twentyDaysAgo = new Date(todayK2b);
    twentyDaysAgo.setDate(todayK2b.getDate() - 20);
    const twentyDaysAgoStr = twentyDaysAgo.toISOString().split('T')[0];

    let q7 = supabase.from("measurement_journal")
      .select("id, business_name, measurement_end_date, measurer")
      .is("k2b_send_date", null) // 미전송 건만
      .not("measurement_end_date", "is", null) // 종료일 있는 건만
      .gte("measurement_end_date", "2025-12-25") // 25.12.25 이후
      .lte("measurement_end_date", twentyDaysAgoStr) // 20일 이상 경과된 건만
      .order("measurement_end_date", { ascending: true }) // 오래된 순
      .limit(1000);

    // 필터 적용 (측정주기 등으로 필터링 가능하도록 수정)
    q7 = applyFilters(q7, 'measurement');
    const { data: overdueItems } = await q7;

    const processedOverdueItems = overdueItems?.map(item => {
      const endDate = new Date(item.measurement_end_date);
      const today = new Date();
      // 경과일: 오늘 - 종료일 (일 단위, 절삭)
      const elapsed = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      const remaining = 30 - elapsed;

      return {
        id: item.id,
        business_name: item.business_name,
        measurement_end_date: item.measurement_end_date,
        measurer: item.measurer || "-",
        elapsed_days: elapsed,
        remaining_days: remaining,
        // 30일 이내면 적합, 초과면 부적합
        status_prediction: elapsed <= 30 ? "적합" : "부적합"
      };
    }) || [];

    // 8. K2B 전송 현황
    let q8 = supabase.from("measurement_journal").select("id, k2b_send_date").not("k2b_send_date", "is", null);
    q8 = applyFilters(q8, 'measurement');
    const { data: k2bData } = await q8;
    const k2bStats = { 전송완료: k2bData?.length || 0, 미전송: totalCount - (k2bData?.length || 0) };

    // 9. 연도/주기별 측정건수 추이 (필터 미적용)
    const { data: countTrendData } = await supabase.from("measurement_journal").select("measurement_year, measurement_period");
    const countTrendMap: Record<string, number> = {};
    countTrendData?.forEach((item) => {
      if (item.measurement_year && item.measurement_period) {
        const key = `${item.measurement_year}-${item.measurement_period}`;
        countTrendMap[key] = (countTrendMap[key] || 0) + 1;
      }
    });
    const countTrendList = Object.entries(countTrendMap)
      .map(([key, count]) => ({ year: parseInt(key.split("-")[0]), period: key.split("-")[1], count }))
      .sort((a, b) => b.year - a.year || (a.period === "상반기" ? -1 : 1));

    // 10. 평균 측정 기간
    let q10 = supabase.from("measurement_journal").select("measurement_start_date, measurement_end_date").not("measurement_start_date", "is", null).not("measurement_end_date", "is", null);
    q10 = applyFilters(q10, 'measurement');
    const { data: measurementPeriodData } = await q10;
    let totalDays = 0; let validPeriodCount = 0;
    measurementPeriodData?.forEach((item) => {
      const startDate = new Date(item.measurement_start_date);
      const endDate = new Date(item.measurement_end_date);
      const days = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (days >= 0) { totalDays += days; validPeriodCount += 1; }
    });
    const averageMeasurementDays = validPeriodCount > 0 ? Math.round(totalDays / validPeriodCount) : 0;

    // 12. 지정지청별 매출
    let q12 = supabase.from("measurement_journal").select("designated_office, measurement_fee_total");
    q12 = applyFilters(q12, 'measurement');
    const { data: officeRevenueData } = await q12;
    const officeRevenueMap: Record<string, number> = {};
    officeRevenueData?.forEach((item) => {
      const office = item.designated_office || "미지정";
      const fee = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      officeRevenueMap[office] = (officeRevenueMap[office] || 0) + fee;
    });
    const officeRevenueList = Object.entries(officeRevenueMap).map(([office, amount]) => ({ office, amount })).sort((a, b) => b.amount - a.amount);

    // 13. 측정주기별 매출
    let q13 = supabase.from("measurement_journal").select("measurement_period, measurement_fee_total");
    q13 = applyFilters(q13, 'measurement');
    const { data: periodRevenueData } = await q13;
    const periodRevenueMap: Record<string, number> = { 상반기: 0, 하반기: 0 };
    periodRevenueData?.forEach((item) => {
      const period = item.measurement_period || "";
      if (period.includes("상반기")) periodRevenueMap["상반기"] += parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      else if (period.includes("하반기")) periodRevenueMap["하반기"] += parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
    });
    const periodRevenueList = Object.entries(periodRevenueMap).map(([period, amount]) => ({ period, amount })).sort((a, b) => a.period === "상반기" ? -1 : 1);

    // 11. 년도별/월별 매출 추이 비교 (수정됨)
    // targetYear 기준 비교: targetYear vs targetYear-1
    // targetYear 없으면: currentYear vs currentYear-1
    const comparisonYear = targetYear || new Date().getFullYear();
    const prevYear = comparisonYear - 1;

    // 비교 데이터 조회 (measurement_year 기준)
    const { data: trendData, error: trendError } = await supabase.from("measurement_journal")
      .select("measurement_year, measurement_period, measurement_fee_total, created_at, measurement_start_date")
      .in("measurement_year", [comparisonYear, prevYear]);

    if (trendError) console.error("Trend Error:", trendError);

    // 11-1. 년도별 추이 (전체)
    const { data: yearlyData } = await supabase.from("measurement_journal").select("measurement_year, measurement_fee_total");
    const yearlyRevenueMap: Record<number, number> = {};
    yearlyData?.forEach(item => {
      if (!item.measurement_year) return;
      yearlyRevenueMap[item.measurement_year] = (yearlyRevenueMap[item.measurement_year] || 0) + (parseFloat(item.measurement_fee_total?.toString() || "0") || 0);
    });
    const yearlyRevenueList = Object.entries(yearlyRevenueMap)
      .map(([year, amount]) => ({ year: parseInt(year), amount }))
      .sort((a, b) => a.year - b.year);

    // 11-2. 월별 비교
    const monthlyStats: Record<string, { current: number | null, previous: number }> = {};
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    for (let i = 1; i <= 12; i++) {
      // 비교 연도가 현재 연도이고, i월이 현재 월보다 미래인 경우 null (데이터 없음) 처리
      // 비교 연도가 과거 연도라면 12월까지 0으로 채움
      let initCurrent: number | null = 0;
      if (comparisonYear === currentYear && i > currentMonth) {
        initCurrent = null;
      }
      monthlyStats[`${i}월`] = { current: initCurrent, previous: 0 };
    }

    trendData?.forEach(item => {
      // 날짜 기준: 측정 시작일 우선, 없으면 생성일, 둘 다 없으면 스킵
      const dateStr = item.measurement_start_date || item.created_at;
      if (!dateStr) return;

      const date = new Date(dateStr);
      const monthKey = `${date.getMonth() + 1}월`;
      const fee = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;

      // 데이터 필터링 (주기)
      if (targetPeriod && !item.measurement_period?.includes(targetPeriod)) return;

      if (item.measurement_year === comparisonYear) {
        const currentVal = monthlyStats[monthKey].current;
        monthlyStats[monthKey].current = (currentVal === null ? 0 : currentVal) + fee;
      } else if (item.measurement_year === prevYear) {
        monthlyStats[monthKey].previous += fee;
      }
    });

    const monthlyComparisonList = Object.entries(monthlyStats).map(([month, val]) => ({
      month,
      current: val.current,
      previous: val.previous
    })).sort((a, b) => parseInt(a.month) - parseInt(b.month));

    return NextResponse.json({
      totalCount, incompleteCount, completeCount, completionRate: Math.round(completionRate * 10) / 10,
      revenue: { measurementFee: totalMeasurementFee, otherRevenue: totalOtherRevenue, total: totalMeasurementFee + totalOtherRevenue, deposit: totalDeposit, depositRate: Math.round(depositRate * 10) / 10 },
      periodStats, nationalSupport: nationalSupportStats,
      overdueItems: processedOverdueItems,
      k2bStats, countTrend: countTrendList, averageMeasurementDays,
      revenueTrend: {
        yearly: yearlyRevenueList,
        monthly: monthlyComparisonList,
        comparisonYear, prevYear
      },
      officeRevenue: officeRevenueList, periodRevenue: periodRevenueList
    });

  } catch (error: any) {
    console.error("Dashboard API Error:", error);
    return NextResponse.json({ error: "API 오류", details: error.message }, { status: 500 });
  }
}
