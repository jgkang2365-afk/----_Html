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
      .select("id, business_name, business_number, designated_office, measurement_year, measurement_period, measurement_start_date, measurement_fee_total, deposit_total, measurement_fee_business, deposit_amount_business, deposit_amount_business_2, measurement_fee_national, deposit_amount_national, k2b_send_date, k2b_status, is_email_sent, last_email_sent_at, invoice_business_name, invoice_business_number, electronic_invoice_date, electronic_invoice_date_2, invoice_email, invoice_email_2, deposit_date_business, deposit_date_business_2, deposit_date_national")
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000)
      .not("business_name", "ilike", "%번외%");

    // 기타 매출은 전체 데이터를 테이블에 표시해야 하므로 전체 컬럼을 선택합니다.
    let otherSummaryQuery = supabase
      .from("other_revenue")
      .select("*")
      .order("revenue_year", { ascending: false })
      .order("revenue_period", { ascending: false })
      .order("id", { ascending: false })
      .limit(10000);

    // 공통 필터 적용 함수
    const applyFilters = (query: any, isOther: boolean = false, excludeYear: boolean = false, includeSearch: boolean = true) => {
      let q = query;
      const yearCol = isOther ? "revenue_year" : "measurement_year";
      const periodCol = isOther ? "revenue_period" : "measurement_period";

      if (year && !excludeYear) {
        if (year.includes(",")) {
          const years = year.split(",").map(y => parseInt(y.trim())).filter(y => !isNaN(y));
          if (years.length > 0) q = q.in(yearCol, years);
        } else {
          q = q.eq(yearCol, parseInt(year));
        }
      }
      // excludeYear가 true인 경우 주기 필터도 적용하지 않음 (집계용 전체 데이터 보장을 위함)
      if (measurementPeriod && !excludeYear) {
        if (measurementPeriod.includes(",")) {
          const periods = measurementPeriod.split(",").map(p => p.trim()).filter(Boolean);
          if (periods.length > 0) q = q.in(periodCol, periods);
        } else {
          q = q.eq(periodCol, measurementPeriod);
        }
      }
      
      // 검색 필터 (사업장명, 대표자명) - 목록 조회 시에만 적용하고 집계 시에는 제외 (사용자 요청)
      if (!isOther && includeSearch) {
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

    // 필터 적용 (목록용 - 검색 포함)
    measurementDataQuery = applyFilters(measurementDataQuery);

    // 정렬 적용 (측정비 전용)
    const isAsc = sortDirection === "asc";
    const isOtherSort = ["revenue_year", "revenue_period", "item_name"].includes(sortColumn);
    const isYearAll = !year;
    
    if (sortColumn === "unpaid") {
       // 미수금 정렬 요청 시, 편의상 측정비 합계 순으로 정렬
       measurementDataQuery = measurementDataQuery.order("measurement_fee_total", { ascending: isAsc });
    } else if (!isOtherSort) {
       // 측정비 테이블에 존재하는 컬럼인 경우에만 정렬 적용
       measurementDataQuery = measurementDataQuery.order(sortColumn, { ascending: isAsc });
    } else {
       // 기본 정렬: 측정년도 내림차순
       measurementDataQuery = measurementDataQuery.order("measurement_year", { ascending: false });
    }

    // 보조 정렬 (일관성 유지 및 상세 시간 역순 보장)
    // 년도 전체일 경우 년도 -> 주기 -> 생성일 모두 내림차순으로 정렬되도록 보강
    if (isYearAll && (sortColumn === "measurement_year" || isOtherSort)) {
      measurementDataQuery = measurementDataQuery
        .order("measurement_period", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      measurementDataQuery = measurementDataQuery
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .order("created_at", { ascending: false });
    }
    
    measurementDataQuery = measurementDataQuery.range(offset, offset + limit - 1);
      
    // 기타 매출 쿼리
    let otherRevenueQuery = supabase.from("other_revenue").select("*");
    otherRevenueQuery = applyFilters(otherRevenueQuery, true);

    // 기타 매출 정렬 적용
    if (isOtherSort) {
      otherRevenueQuery = otherRevenueQuery.order(sortColumn, { ascending: isAsc });
    } else {
      otherRevenueQuery = otherRevenueQuery.order("revenue_year", { ascending: false });
    }
    otherRevenueQuery = otherRevenueQuery.order("revenue_period", { ascending: false });

    // 데이터 로딩 병렬 처리
    const [
      { data: measurementRevenue, count: totalCount, error: measurementError },
      { data: otherRevenue, error: otherError },
      { data: allMeasurementForSummary },
      { data: allOtherForSummary }
    ] = await Promise.all([
      measurementDataQuery,
      otherRevenueQuery,
      // 집계용 데이터는 년도 필터와 검색 필터(사업장/대표자) 제외 (통계의 정확성 유지)
      applyFilters(measurementSummaryQuery, false, true, false),
      applyFilters(otherSummaryQuery, true, true, false)
    ]);

    if (measurementError || otherError) {
      console.error("매출 조회 오류:", measurementError || otherError);
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

    // 측정비 집계 (측정비 전용 집계 데이터 생성)
    (allMeasurementForSummary || []).forEach((item: any) => {
      // 부서별 집계(officeSummary)는 사용자가 선택한 년도 및 주기에 해당하는 데이터만 포함
      const isSelectedYear = !year || item.measurement_year === parseInt(year);
      const isSelectedPeriod = !measurementPeriod || item.measurement_period === measurementPeriod;
      
      const shortOffice = item.designated_office ? toShortName(item.designated_office) : "기타";
      const officeKey = offices.includes(shortOffice as any) ? shortOffice : "기타";
      const revenue = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
      
      if (isSelectedYear && isSelectedPeriod) {
        officeSummary[officeKey].measurementRevenue += revenue;
        officeSummary[officeKey].measurementTotal += revenue;
        officeSummary[officeKey].measurementDeposit += deposit;
        officeSummary[officeKey].measurementUnpaid += (revenue - deposit);
      }
    });

    // 기타 매출 집계 (측정비와 섞이지 않도록 별도 항목으로 집계)
    (allOtherForSummary || []).forEach((item: any) => {
      // 부서별 집계(officeSummary)는 사용자가 선택한 년도 및 주기에 해당하는 데이터만 포함
      const isSelectedYear = !year || item.revenue_year === parseInt(year);
      // 기타 매출은 measurementPeriod 파라미터를 그대로 사용하거나 필요시 별도 처리
      const isSelectedPeriod = !measurementPeriod || item.revenue_period === measurementPeriod;

      const shortOffice = item.designated_office ? toShortName(item.designated_office) : "기타";
      const officeKey = offices.includes(shortOffice as any) ? shortOffice : "기타";
      const supply = parseFloat(item.supply_amount?.toString() || "0") || 0;
      const vat = parseFloat(item.vat_amount?.toString() || "0") || 0;
      const total = parseFloat(item.total_amount?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_amount?.toString() || "0") || 0;
      
      if (isSelectedYear && isSelectedPeriod) {
        officeSummary[officeKey].otherRevenue += supply;
        officeSummary[officeKey].otherVat += vat;
        officeSummary[officeKey].otherTotal += total;
        officeSummary[officeKey].otherDeposit += deposit;
        officeSummary[officeKey].otherUnpaid += (total - deposit);
      }
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
      
      // 주기 판별: 문자열 우선, 없으면 시작일 기준
      let period = "secondHalf";
      if (item.measurement_period) {
        if (item.measurement_period.includes("상반기") || item.measurement_period.includes("수시(상)")) {
          period = "firstHalf";
        } else if (item.measurement_period.includes("하반기") || item.measurement_period.includes("수시(하)")) {
          period = "secondHalf";
        }
      } else if (item.measurement_start_date) {
        // measurement_start_date가 'YYYY-MM-DD' 형식이면 두 번째 파트가 월
        const parts = item.measurement_start_date.split("-");
        if (parts.length >= 2) {
          const month = parseInt(parts[1]);
          if (month >= 1 && month <= 6) period = "firstHalf";
        }
      }

      const revenue = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
      
      yearlySummary[year][period].measurementRevenue += revenue;
      yearlySummary[year][period].measurementTotal += revenue;
      yearlySummary[year][period].measurementDeposit += deposit;
      yearlySummary[year][period].measurementUnpaid += (revenue - deposit);
      
      // 전체 합계(total)에도 추가
      yearlySummary[year].total.measurementRevenue += revenue;
      yearlySummary[year].total.measurementTotal += revenue;
      yearlySummary[year].total.measurementDeposit += deposit;
      yearlySummary[year].total.measurementUnpaid += (revenue - deposit);
    });

    (allOtherForSummary || []).forEach((item: any) => {
      const year = item.revenue_year;
      if (!year) return;
      if (!yearlySummary[year]) yearlySummary[year] = { firstHalf: createEmptySummary(), secondHalf: createEmptySummary(), total: createEmptySummary() };
      
      let period = "secondHalf";
      if (item.revenue_period) {
        if (item.revenue_period.includes("상반기") || item.revenue_period.includes("수시(상)")) {
          period = "firstHalf";
        } else if (item.revenue_period.includes("하반기") || item.revenue_period.includes("수시(하)")) {
          period = "secondHalf";
        }
      }
      
      const supply = parseFloat(item.supply_amount?.toString() || "0") || 0;
      const vat = parseFloat(item.vat_amount?.toString() || "0") || 0;
      const total = parseFloat(item.total_amount?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_amount?.toString() || "0") || 0;
      
      yearlySummary[year][period].otherRevenue += supply;
      yearlySummary[year][period].otherVat += vat;
      yearlySummary[year][period].otherTotal += total;
      yearlySummary[year][period].otherDeposit += deposit;
      yearlySummary[year][period].otherUnpaid += (total - deposit);
      
      // 전체 합계(total)에도 추가
      yearlySummary[year].total.otherRevenue += supply;
      yearlySummary[year].total.otherVat += vat;
      yearlySummary[year].total.otherTotal += total;
      yearlySummary[year].total.otherDeposit += deposit;
      yearlySummary[year].total.otherUnpaid += (total - deposit);
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
      allOtherData: (allOtherForSummary || []).map((item: any) => ({
        ...item,
        designated_office: item.designated_office ? toShortName(item.designated_office) : item.designated_office,
      })),
      otherRevenue: (otherRevenue || []).map((item: any) => ({
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
