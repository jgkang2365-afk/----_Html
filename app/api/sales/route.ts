import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { DESIGNATED_OFFICES, toShortName } from "@/lib/constants/designated-offices";

/**
 * 매출관리 조회 API
 * 측정비와 기타 매출을 조회하고 집계
 * GET /api/sales
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("sales:read");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const representativeName = searchParams.get("representativeName")?.trim() || null;
    const measurementPeriod = searchParams.get("measurementPeriod")?.trim() || null;
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;
    
    // 정렬 파라미터
    const sortColumn = searchParams.get("sortColumn") || "measurement_year";
    const sortDirection = searchParams.get("sortDirection") || "desc";
    
    // 페이지네이션 파라미터
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = (page - 1) * limit;

    const supabase = await createClient();

    // --- [최적화 1] 집계 계산을 위한 가벼운 전체 데이터 조회 ---
    // 전체 목록을 가져오는 대신, 계산에 꼭 필요한 컬럼만 선택하여 속도 향상
    // StatTables 컴포넌트에서 미수금 상세 분석 등을 위해 추가 컬럼이 필요하므로 포함합니다.
    let measurementSummaryQuery = supabase
      .from("measurement_journal")
      .select("id, business_name, designated_office, measurement_year, measurement_period, measurement_fee_total, deposit_total, measurement_fee_business, deposit_amount_business, deposit_amount_business_2, measurement_fee_national, deposit_amount_national")
      .not("business_name", "ilike", "%번외%");

    // 기타 매출은 전체 데이터를 테이블에 표시해야 하므로 전체 컬럼을 선택합니다.
    let otherSummaryQuery = supabase
      .from("other_revenue")
      .select("*");

    // 공통 필터 적용 함수
    const applyFilters = (query: any, isOther: boolean = false) => {
      let q = query;
      const yearCol = isOther ? "revenue_year" : "measurement_year";
      const periodCol = isOther ? "revenue_period" : "measurement_period";

      if (year) {
        if (year.includes(",")) {
          const years = year.split(",").map(y => parseInt(y.trim())).filter(y => !isNaN(y));
          if (years.length > 0) q = q.in(yearCol, years);
        } else {
          q = q.eq(yearCol, parseInt(year));
        }
      }
      if (measurementPeriod) {
        if (measurementPeriod.includes(",")) {
          const periods = measurementPeriod.split(",").map(p => p.trim()).filter(Boolean);
          if (periods.length > 0) q = q.in(periodCol, periods);
        } else {
          q = q.eq(periodCol, measurementPeriod);
        }
      }
      if (!isOther) {
        if (businessName) {
          if (businessName.includes(",")) {
            const names = businessName.split(",").map(n => n.trim()).filter(Boolean);
            if (names.length > 0) {
              const orFilter = names.map(name => `business_name.ilike.%${name}%`).join(",");
              q = q.or(orFilter);
            }
          } else {
            q = q.ilike("business_name", `%${businessName}%`);
          }
        }
        if (representativeName) {
          q = q.ilike("representative_name", `%${representativeName}%`);
        }
      }
      if (designatedOffice) {
        const officeList = designatedOffice.split(",").map(o => o.trim()).filter(Boolean);
        if (officeList.length > 0) {
          const allOffices: string[] = [];
          officeList.forEach(office => {
            const normalized = toShortName(office);
            allOffices.push(normalized);
            if (normalized !== office) allOffices.push(office);
          });
          q = q.in("designated_office", allOffices);
        }
      }
      return q;
    };

    // --- [최적화 2] 테이블용 페이지네이션 데이터 조회 ---
    let measurementDataQuery = supabase
      .from("measurement_journal")
      .select("*", { count: "exact" })
      .not("business_name", "ilike", "%번외%");

    // 필터 적용
    measurementDataQuery = applyFilters(measurementDataQuery);

    // 정렬 적용
    const isAsc = sortDirection === "asc";
    if (sortColumn === "unpaid") {
       // 미수금 정렬 요청 시, 편의상 측정비 합계 순으로 정렬
       measurementDataQuery = measurementDataQuery.order("measurement_fee_total", { ascending: isAsc });
    } else {
       measurementDataQuery = measurementDataQuery.order(sortColumn, { ascending: isAsc });
    }

    // 보조 정렬 (일관성 유지)
    measurementDataQuery = measurementDataQuery
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    
    // 데이터 로딩 병렬 처리
    const [
      { data: measurementRevenue, count: totalCount, error: measurementError },
      { data: allMeasurementForSummary },
      { data: allOtherForSummary }
    ] = await Promise.all([
      measurementDataQuery,
      applyFilters(measurementSummaryQuery),
      applyFilters(otherSummaryQuery, true)
    ]);

    if (measurementError) {
      console.error("측정비 매출 조회 오류:", measurementError);
      return NextResponse.json({ error: "데이터를 불러오는 중 오류가 발생했습니다." }, { status: 500 });
    }

    // 3. 집계 데이터 계산
    const offices = [...DESIGNATED_OFFICES];
    const officeSummary: Record<string, any> = {};
    const createEmptySummary = () => ({
      measurementRevenue: 0, measurementVat: 0, measurementTotal: 0, measurementDeposit: 0, measurementUnpaid: 0,
      otherRevenue: 0, otherVat: 0, otherTotal: 0, otherDeposit: 0, otherUnpaid: 0,
      totalRevenue: 0, totalVat: 0, totalAmount: 0, totalDeposit: 0, totalUnpaid: 0,
    });

    [...offices, "기타"].forEach(office => {
      officeSummary[office] = createEmptySummary();
    });

    // 측정비 집계
    (allMeasurementForSummary || []).forEach((item: any) => {
      const shortOffice = item.designated_office ? toShortName(item.designated_office) : "기타";
      const officeKey = offices.includes(shortOffice as any) ? shortOffice : "기타";
      const revenue = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
      officeSummary[officeKey].measurementRevenue += revenue;
      officeSummary[officeKey].measurementTotal += revenue;
      officeSummary[officeKey].measurementDeposit += deposit;
      officeSummary[officeKey].measurementUnpaid += (revenue - deposit);
    });

    // 기타 매출 집계
    (allOtherForSummary || []).forEach((item: any) => {
      const shortOffice = item.designated_office ? toShortName(item.designated_office) : "기타";
      const officeKey = offices.includes(shortOffice as any) ? shortOffice : "기타";
      const supply = parseFloat(item.supply_amount?.toString() || "0") || 0;
      const vat = parseFloat(item.vat_amount?.toString() || "0") || 0;
      const total = parseFloat(item.total_amount?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_amount?.toString() || "0") || 0;
      officeSummary[officeKey].otherRevenue += supply;
      officeSummary[officeKey].otherVat += vat;
      officeSummary[officeKey].otherTotal += total;
      officeSummary[officeKey].otherDeposit += deposit;
      officeSummary[officeKey].otherUnpaid += (total - deposit);
    });

    // 최종 합계 계산
    Object.keys(officeSummary).forEach(o => {
      const s = officeSummary[o];
      s.totalRevenue = s.measurementRevenue + s.otherRevenue;
      s.totalVat = s.measurementVat + s.otherVat;
      s.totalAmount = s.measurementTotal + s.otherTotal;
      s.totalDeposit = s.measurementDeposit + s.otherDeposit;
      s.totalUnpaid = s.measurementUnpaid + s.otherUnpaid;
    });

    // 년도별 집계
    const yearlySummary: Record<number, any> = {};
    (allMeasurementForSummary || []).forEach((item: any) => {
      const year = item.measurement_year;
      if (!year) return;
      if (!yearlySummary[year]) yearlySummary[year] = { firstHalf: createEmptySummary(), secondHalf: createEmptySummary(), total: createEmptySummary() };
      const period = item.measurement_period === "상반기" ? "firstHalf" : "secondHalf";
      const revenue = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
      yearlySummary[year][period].measurementRevenue += revenue;
      yearlySummary[year][period].measurementTotal += revenue;
      yearlySummary[year][period].measurementDeposit += deposit;
      yearlySummary[year][period].measurementUnpaid += (revenue - deposit);
    });

    (allOtherForSummary || []).forEach((item: any) => {
      const year = item.revenue_year;
      if (!year) return;
      if (!yearlySummary[year]) yearlySummary[year] = { firstHalf: createEmptySummary(), secondHalf: createEmptySummary(), total: createEmptySummary() };
      const period = item.revenue_period === "상반기" ? "firstHalf" : "secondHalf";
      const supply = parseFloat(item.supply_amount?.toString() || "0") || 0;
      const vat = parseFloat(item.vat_amount?.toString() || "0") || 0;
      const total = parseFloat(item.total_amount?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_amount?.toString() || "0") || 0;
      yearlySummary[year][period].otherRevenue += supply;
      yearlySummary[year][period].otherVat += vat;
      yearlySummary[year][period].otherTotal += total;
      yearlySummary[year][period].otherDeposit += deposit;
      yearlySummary[year][period].otherUnpaid += (total - deposit);
    });

    Object.keys(yearlySummary).forEach(yearStr => {
      const s = yearlySummary[parseInt(yearStr)];
      Object.keys(s.firstHalf).forEach(key => { s.total[key] = s.firstHalf[key] + s.secondHalf[key]; });
      [s.firstHalf, s.secondHalf, s.total].forEach(ps => {
         ps.totalRevenue = ps.measurementRevenue + ps.otherRevenue;
         ps.totalVat = ps.measurementVat + ps.otherVat;
         ps.totalAmount = ps.measurementTotal + ps.otherTotal;
         ps.totalDeposit = ps.measurementDeposit + ps.otherDeposit;
         ps.totalUnpaid = ps.measurementUnpaid + ps.otherUnpaid;
      });
    });

    return NextResponse.json({
      success: true,
      measurementRevenue: (measurementRevenue || []).map((item: any) => ({
        ...item,
        designated_office: item.designated_office ? toShortName(item.designated_office) : item.designated_office,
      })),
      allMeasurementData: (allMeasurementForSummary || []).map((item: any) => ({
        ...item,
        designated_office: item.designated_office ? toShortName(item.designated_office) : item.designated_office,
      })),
      otherRevenue: (allOtherForSummary || []).map((item: any) => ({
        ...item,
        designated_office: item.designated_office ? toShortName(item.designated_office) : item.designated_office,
      })),
      summary: { byOffice: officeSummary, byYear: yearlySummary },
      pagination: { totalCount: totalCount || 0, totalPages: Math.ceil((totalCount || 0) / limit), currentPage: page, pageSize: limit }
    }, { status: 200 });

  } catch (error: any) {
    console.error("매출관리 조회 오류:", error);
    return NextResponse.json(
      { error: error.message || "매출관리 데이터를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
