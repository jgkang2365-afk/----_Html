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
    const measurementPeriod = searchParams.get("measurementPeriod")?.trim() || null;
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;

    const supabase = await createClient();

    // 1. 측정비 매출 조회 (measurement_journal)
    let measurementQuery = supabase
      .from("measurement_journal")
      .select("*")
      .not("business_name", "ilike", "%번외%")
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("created_at", { ascending: false });

    if (year) {
      if (year.includes(",")) {
        const years = year.split(",").map(y => parseInt(y.trim())).filter(y => !isNaN(y));
        if (years.length > 0) {
          measurementQuery = measurementQuery.in("measurement_year", years);
        }
      } else {
        measurementQuery = measurementQuery.eq("measurement_year", parseInt(year));
      }
    }

    if (businessName) {
      if (businessName.includes(",")) {
        const names = businessName.split(",").map(n => n.trim()).filter(Boolean);
        if (names.length > 0) {
          const orFilter = names.map(name => `business_name.ilike.%${name}%`).join(",");
          measurementQuery = measurementQuery.or(orFilter);
        }
      } else {
        measurementQuery = measurementQuery.ilike("business_name", `%${businessName}%`);
      }
    }

    if (measurementPeriod) {
      if (measurementPeriod.includes(",")) {
        const periods = measurementPeriod.split(",").map(p => p.trim()).filter(Boolean);
        if (periods.length > 0) {
          measurementQuery = measurementQuery.in("measurement_period", periods);
        }
      } else {
        measurementQuery = measurementQuery.eq("measurement_period", measurementPeriod);
      }
    }

    if (designatedOffice) {
      const officeList = designatedOffice.split(",").map(o => o.trim()).filter(Boolean);
      if (officeList.length > 0) {
        const allOffices: string[] = [];
        officeList.forEach(office => {
          const normalized = toShortName(office);
          allOffices.push(normalized);
          if (normalized !== office) {
            allOffices.push(office);
          }
        });
        measurementQuery = measurementQuery.in("designated_office", allOffices);
      }
    }

    const { data: measurementRevenue, error: measurementError } = await measurementQuery;

    if (measurementError) {
      console.error("측정비 매출 조회 오류:", measurementError);
      return NextResponse.json(
        { error: "측정비 매출을 불러오는 중 오류가 발생했습니다.", details: measurementError.message },
        { status: 500 }
      );
    }

    // 2. 기타 매출 조회 (other_revenue)
    let otherRevenue: any[] = [];
    try {
      let otherQuery = supabase
        .from("other_revenue")
        .select("*")
        .order("revenue_year", { ascending: false })
        .order("revenue_period", { ascending: false })
        .order("created_at", { ascending: false });

      if (year) {
        if (year.includes(",")) {
          const years = year.split(",").map(y => parseInt(y.trim())).filter(y => !isNaN(y));
          if (years.length > 0) {
            otherQuery = otherQuery.in("revenue_year", years);
          }
        } else {
          otherQuery = otherQuery.eq("revenue_year", parseInt(year));
        }
      }
      if (measurementPeriod) {
        if (measurementPeriod.includes(",")) {
          const periods = measurementPeriod.split(",").map(p => p.trim()).filter(Boolean);
          if (periods.length > 0) {
            otherQuery = otherQuery.in("revenue_period", periods);
          }
        } else {
          otherQuery = otherQuery.eq("revenue_period", measurementPeriod);
        }
      }

      const { data, error: otherError } = await otherQuery;

      if (otherError) {
        console.error("기타 매출 조회 오류:", otherError);
        // 기타 매출 테이블이 없을 수 있으므로 에러를 무시하고 빈 배열로 처리
        if (otherError.code === "42P01" || otherError.message?.includes("does not exist")) {
          console.warn("other_revenue 테이블이 존재하지 않습니다. 마이그레이션을 실행해주세요.");
        }
        otherRevenue = [];
      } else {
        otherRevenue = data || [];
      }
    } catch (err: any) {
      console.error("기타 매출 조회 예외:", err);
      otherRevenue = [];
    }

    // 3. 집계 데이터 계산
    const offices = [...DESIGNATED_OFFICES];

    // otherRevenue가 undefined일 경우 빈 배열로 설정
    if (!otherRevenue) {
      otherRevenue = [];
    }

    // 지정한계_관할지청별 집계
    const officeSummary: Record<string, {
      measurementRevenue: number;
      measurementVat: number;
      measurementTotal: number;
      measurementDeposit: number;
      measurementUnpaid: number;
      otherRevenue: number;
      otherVat: number;
      otherTotal: number;
      otherDeposit: number;
      otherUnpaid: number;
      totalRevenue: number;
      totalVat: number;
      totalAmount: number;
      totalDeposit: number;
      totalUnpaid: number;
    }> = {};

    // 초기화
    offices.forEach(office => {
      officeSummary[office] = {
        measurementRevenue: 0,
        measurementVat: 0,
        measurementTotal: 0,
        measurementDeposit: 0,
        measurementUnpaid: 0,
        otherRevenue: 0,
        otherVat: 0,
        otherTotal: 0,
        otherDeposit: 0,
        otherUnpaid: 0,
        totalRevenue: 0,
        totalVat: 0,
        totalAmount: 0,
        totalDeposit: 0,
        totalUnpaid: 0,
      };
    });
    officeSummary["기타"] = {
      measurementRevenue: 0,
      measurementVat: 0,
      measurementTotal: 0,
      measurementDeposit: 0,
      measurementUnpaid: 0,
      otherRevenue: 0,
      otherVat: 0,
      otherTotal: 0,
      otherDeposit: 0,
      otherUnpaid: 0,
      totalRevenue: 0,
      totalVat: 0,
      totalAmount: 0,
      totalDeposit: 0,
      totalUnpaid: 0,
    };

    // 측정비 집계 (부가세 없음)
    (measurementRevenue || []).forEach((item: any) => {
      const office = item.designated_office || "기타";
      const officeKey = offices.includes(office) ? office : "기타";

      const revenue = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
      const unpaid = revenue - deposit;

      // 측정비는 부가세 없음 (매출금액 = 매출총액)
      officeSummary[officeKey].measurementRevenue += revenue;
      officeSummary[officeKey].measurementVat += 0; // 측정비는 부가세 없음
      officeSummary[officeKey].measurementTotal += revenue;
      officeSummary[officeKey].measurementDeposit += deposit;
      officeSummary[officeKey].measurementUnpaid += unpaid;
    });

    // 기타 매출 집계
    (otherRevenue || []).forEach((item: any) => {
      const office = item.designated_office || "기타";
      const officeKey = offices.includes(office) ? office : "기타";

      const supply = parseFloat(item.supply_amount?.toString() || "0") || 0;
      const vat = parseFloat(item.vat_amount?.toString() || "0") || 0;
      const total = parseFloat(item.total_amount?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_amount?.toString() || "0") || 0;
      const unpaid = total - deposit;

      officeSummary[officeKey].otherRevenue += supply;
      officeSummary[officeKey].otherVat += vat;
      officeSummary[officeKey].otherTotal += total;
      officeSummary[officeKey].otherDeposit += deposit;
      officeSummary[officeKey].otherUnpaid += unpaid;
    });

    // 합계 계산
    Object.keys(officeSummary).forEach(office => {
      const summary = officeSummary[office];
      summary.totalRevenue = summary.measurementRevenue + summary.otherRevenue;
      summary.totalVat = summary.measurementVat + summary.otherVat;
      summary.totalAmount = summary.measurementTotal + summary.otherTotal;
      summary.totalDeposit = summary.measurementDeposit + summary.otherDeposit;
      summary.totalUnpaid = summary.measurementUnpaid + summary.otherUnpaid;
    });

    // 년도별 집계 (상반기/하반기)
    const yearlySummary: Record<number, {
      firstHalf: typeof officeSummary[string];
      secondHalf: typeof officeSummary[string];
      total: typeof officeSummary[string];
    }> = {};

    // 빈 집계 객체 생성 함수
    const createEmptySummary = () => ({
      measurementRevenue: 0,
      measurementVat: 0,
      measurementTotal: 0,
      measurementDeposit: 0,
      measurementUnpaid: 0,
      otherRevenue: 0,
      otherVat: 0,
      otherTotal: 0,
      otherDeposit: 0,
      otherUnpaid: 0,
      totalRevenue: 0,
      totalVat: 0,
      totalAmount: 0,
      totalDeposit: 0,
      totalUnpaid: 0,
    });

    // 측정비 년도별 집계
    (measurementRevenue || []).forEach((item: any) => {
      const year = item.measurement_year;
      if (!year) return;

      if (!yearlySummary[year]) {
        yearlySummary[year] = {
          firstHalf: createEmptySummary(),
          secondHalf: createEmptySummary(),
          total: createEmptySummary(),
        };
      }

      const period = item.measurement_period === "상반기" ? "firstHalf" : "secondHalf";

      const revenue = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
      const unpaid = revenue - deposit;

      // 측정비는 부가세 없음 (공급가액 = 합계)
      yearlySummary[year][period].measurementRevenue += revenue;
      yearlySummary[year][period].measurementVat += 0; // 측정비는 부가세 없음
      yearlySummary[year][period].measurementTotal += revenue;
      yearlySummary[year][period].measurementDeposit += deposit;
      yearlySummary[year][period].measurementUnpaid += unpaid;
    });

    // 기타 매출 년도별 집계
    (otherRevenue || []).forEach((item: any) => {
      const year = item.revenue_year;
      if (!year) return;

      if (!yearlySummary[year]) {
        yearlySummary[year] = {
          firstHalf: createEmptySummary(),
          secondHalf: createEmptySummary(),
          total: createEmptySummary(),
        };
      }

      const period = item.revenue_period === "상반기" ? "firstHalf" : "secondHalf";

      const supply = parseFloat(item.supply_amount?.toString() || "0") || 0;
      const vat = parseFloat(item.vat_amount?.toString() || "0") || 0;
      const total = parseFloat(item.total_amount?.toString() || "0") || 0;
      const deposit = parseFloat(item.deposit_amount?.toString() || "0") || 0;
      const unpaid = total - deposit;

      yearlySummary[year][period].otherRevenue += supply;
      yearlySummary[year][period].otherVat += vat;
      yearlySummary[year][period].otherTotal += total;
      yearlySummary[year][period].otherDeposit += deposit;
      yearlySummary[year][period].otherUnpaid += unpaid;
    });

    // 년도별 합계 계산
    Object.keys(yearlySummary).forEach(yearStr => {
      const year = parseInt(yearStr);
      const summary = yearlySummary[year];

      // 상반기 + 하반기 = 합계
      Object.keys(summary.firstHalf).forEach(key => {
        summary.total[key as keyof typeof summary.total] =
          summary.firstHalf[key as keyof typeof summary.firstHalf] +
          summary.secondHalf[key as keyof typeof summary.secondHalf];
      });

      // 각 기간별로 totalRevenue, totalVat, totalAmount 계산
      [summary.firstHalf, summary.secondHalf, summary.total].forEach(periodSummary => {
        periodSummary.totalRevenue = periodSummary.measurementRevenue + periodSummary.otherRevenue;
        periodSummary.totalVat = periodSummary.measurementVat + periodSummary.otherVat;
        periodSummary.totalAmount = periodSummary.measurementTotal + periodSummary.otherTotal;
        periodSummary.totalDeposit = periodSummary.measurementDeposit + periodSummary.otherDeposit;
        periodSummary.totalUnpaid = periodSummary.measurementUnpaid + periodSummary.otherUnpaid;
      });
    });

    // 반환 데이터의 designated_office를 약칭으로 변환
    const normalizedMeasurementRevenue = (measurementRevenue || []).map((item: any) => ({
      ...item,
      designated_office: item.designated_office ? toShortName(item.designated_office) : item.designated_office,
    }));

    const normalizedOtherRevenue = (otherRevenue || []).map((item: any) => ({
      ...item,
      designated_office: item.designated_office ? toShortName(item.designated_office) : item.designated_office,
    }));

    return NextResponse.json({
      success: true,
      measurementRevenue: normalizedMeasurementRevenue,
      otherRevenue: normalizedOtherRevenue,
      summary: {
        byOffice: officeSummary,
        byYear: yearlySummary,
      },
    }, { status: 200 });
  } catch (error: any) {
    console.error("매출관리 조회 오류:", error);
    return NextResponse.json(
      { error: error.message || "매출관리 데이터를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
