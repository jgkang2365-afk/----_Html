import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";

/**
 * 측정 대상 사업장 목록 엑셀 다운로드 API
 * GET /api/export/businesses
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    const supabase = await createClient();

    // 측정 대상 사업장 목록 조회 (measurement_target_business 테이블)
    let query = supabase
      .from("measurement_target_business")
      .select("*")
      .order("year", { ascending: false })
      .order("period", { ascending: false })
      .order("code", { ascending: true });

    if (year) {
      query = query.eq("year", parseInt(year));
    }

    if (period) {
      query = query.eq("period", period);
    }

    const { data: businesses, error } = await query;

    if (error) {
      console.error("측정 대상 사업장 목록 조회 오류:", error);
      return NextResponse.json(
        { error: "측정 대상 사업장 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 건강디딤돌 신청결과 조회 (국고지원 상태)
    const codes = (businesses || []).map((b: any) => b.code).filter(Boolean);
    let nationalSupportMap = new Map<string, string | null>();
    
    if (codes.length > 0) {
      let nationalSupportQuery = supabase
        .from("national_support_application")
        .select("code, year, period, national_support_status")
        .in("code", codes);
      
      if (year) {
        nationalSupportQuery = nationalSupportQuery.eq("year", parseInt(year));
      }
      
      if (period) {
        nationalSupportQuery = nationalSupportQuery.eq("period", period);
      }

      const { data: nationalSupportData, error: nationalSupportError } = await nationalSupportQuery;

      if (!nationalSupportError && nationalSupportData) {
        nationalSupportData.forEach((item: any) => {
          const key = `${item.code}-${item.year}-${item.period}`;
          nationalSupportMap.set(key, item.national_support_status || null);
        });
      }
    }

    // 측정일지에서 국고지원 상태 조회
    let journalNationalSupportMap = new Map<string, string | null>();
    if (codes.length > 0) {
      let journalQuery = supabase
        .from("measurement_journal")
        .select("code, measurement_year, measurement_period, national_support_status")
        .in("code", codes);
      
      if (year) {
        journalQuery = journalQuery.eq("measurement_year", parseInt(year));
      }
      
      if (period) {
        journalQuery = journalQuery.eq("measurement_period", period);
      }

      const { data: journalData, error: journalError } = await journalQuery;
      
      if (!journalError && journalData) {
        journalData.forEach((item: any) => {
          const key = `${item.code}-${item.measurement_year}-${item.measurement_period}`;
          journalNationalSupportMap.set(key, item.national_support_status || null);
        });
      }
    }

    // 엑셀 데이터 준비
    const excelData = (businesses || []).map((business) => {
      // 국고지원 상태 결정 (우선순위: measurement_journal > national_support_application > measurement_target_business)
      const nationalSupportKey = `${business.code}-${business.year}-${business.period}`;
      const nationalSupportStatus = 
        journalNationalSupportMap.get(nationalSupportKey) ||
        nationalSupportMap.get(nationalSupportKey) ||
        business.national_support_status ||
        null;

      return {
        코드: business.code || "",
        측정년도: business.year || "",
        측정주기: business.period || "",
        사업장명: business.business_name || "",
        사업자번호: business.business_number || "",
        총인원: business.total_employees || "",
        주소: business.address || "",
        관할청명: business.office_jurisdiction || "",
        지정한계_관할지청: business.designated_office || "",
        측정자: business.measurer || "",
        측정시작일: business.measurement_start_date || "",
        측정종료일: business.measurement_end_date || "",
        완료여부: business.completion_status || "",
        국고지원상태: nationalSupportStatus || "",
        담당자명: business.manager_name || "",
        담당자휴대폰: business.manager_mobile || "",
        담당자전화: business.manager_phone || "",
        향후측정예상일: business.future_measurement_date || "",
        비고: business.notes || "",
        등록여부: business.is_registered ? "등록됨" : "미등록",
        등록일시: business.registered_at
          ? new Date(business.registered_at).toLocaleString("ko-KR")
          : "",
        생성일시: business.created_at
          ? new Date(business.created_at).toLocaleString("ko-KR")
          : "",
        수정일시: business.updated_at
          ? new Date(business.updated_at).toLocaleString("ko-KR")
          : "",
      };
    });

    // 엑셀 워크북 생성
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "측정대상사업장목록");

    // 엑셀 파일 생성
    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // 파일명 생성
    const fileName = `측정대상사업장목록_${year || "전체"}_${period || "전체"}_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(excelBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("측정 대상 사업장 엑셀 다운로드 오류:", error);
    return NextResponse.json(
      {
        error: "엑셀 다운로드 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
