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

    // 측정일지에서 국고지원 상태 및 business_category 조회
    let journalNationalSupportMap = new Map<string, string | null>();
    let businessCategoryMap = new Map<string, string | null>();
    if (codes.length > 0) {
      let journalQuery = supabase
        .from("measurement_journal")
        .select("code, measurement_year, measurement_period, national_support_status, business_category")
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
          businessCategoryMap.set(key, item.business_category || null);
        });
      }
    }

    // 전회 측정일 조회
    let previousMeasurementDateMap = new Map<string, string | null>();
    if (codes.length > 0 && year && period) {
      try {
        const targetYear = parseInt(year);
        // 우선순위에 따라 조회할 년도/주기 결정
        let priorityYear: number;
        let priorityPeriod: string;
        let fallbackYear: number | null = null;
        let fallbackPeriod: string | null = null;

        if (period === "상반기") {
          // 상반기: 이전 년도 하반기 -> 이전 년도 상반기
          priorityYear = targetYear - 1;
          priorityPeriod = "하반기";
          fallbackYear = targetYear - 1;
          fallbackPeriod = "상반기";
        } else {
          // 하반기: 같은 년도 상반기 -> 이전 년도 하반기
          priorityYear = targetYear;
          priorityPeriod = "상반기";
          fallbackYear = targetYear - 1;
          fallbackPeriod = "하반기";
        }

        // 우선순위 측정일지 조회
        try {
          const { data: priorityJournals, error: priorityError } = await supabase
            .from("measurement_journal")
            .select("code, measurement_start_date, measurement_end_date")
            .in("code", codes)
            .eq("measurement_year", priorityYear)
            .eq("measurement_period", priorityPeriod)
            .or("measurement_start_date.not.is.null,measurement_end_date.not.is.null");

          if (!priorityError && priorityJournals) {
            priorityJournals.forEach((journal: any) => {
              if (journal.code && !previousMeasurementDateMap.has(journal.code)) {
                const measurementDate = journal.measurement_end_date || journal.measurement_start_date;
                if (measurementDate) {
                  previousMeasurementDateMap.set(journal.code, measurementDate);
                }
              }
            });
          }
        } catch (priorityErr) {
          console.error("우선순위 전회 측정일 조회 중 예외 발생:", priorityErr);
        }

        // Fallback 조회
        if (fallbackYear !== null && fallbackPeriod !== null) {
          const missingCodes = codes.filter(code => !previousMeasurementDateMap.has(code));
          if (missingCodes.length > 0) {
            try {
              const { data: fallbackJournals, error: fallbackError } = await supabase
                .from("measurement_journal")
                .select("code, measurement_start_date, measurement_end_date")
                .in("code", missingCodes)
                .eq("measurement_year", fallbackYear)
                .eq("measurement_period", fallbackPeriod)
                .or("measurement_start_date.not.is.null,measurement_end_date.not.is.null");

              if (!fallbackError && fallbackJournals) {
                fallbackJournals.forEach((journal: any) => {
                  if (journal.code && !previousMeasurementDateMap.has(journal.code)) {
                    const measurementDate = journal.measurement_end_date || journal.measurement_start_date;
                    if (measurementDate) {
                      previousMeasurementDateMap.set(journal.code, measurementDate);
                    }
                  }
                });
              }
            } catch (fallbackErr) {
              console.error("Fallback 전회 측정일 조회 중 예외 발생:", fallbackErr);
            }
          }
        }
      } catch (error) {
        console.error("전회 측정일 조회 중 예외 발생:", error);
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

      // business_category 조회
      const businessCategory = businessCategoryMap.get(nationalSupportKey) || null;

      // 전회측정일 조회 및 포맷팅
      let previousMeasurementDateFormatted = "";
      const previousMeasurementDate = previousMeasurementDateMap.get(business.code);
      if (previousMeasurementDate) {
        try {
          const date = new Date(previousMeasurementDate);
          previousMeasurementDateFormatted = date.toISOString().split("T")[0];
        } catch {
          previousMeasurementDateFormatted = previousMeasurementDate;
        }
      }

      // 금회예정일 (future_measurement_date)
      let futureMeasurementDateFormatted = "";
      if (business.future_measurement_date) {
        try {
          const date = new Date(business.future_measurement_date);
          futureMeasurementDateFormatted = date.toISOString().split("T")[0];
        } catch {
          futureMeasurementDateFormatted = business.future_measurement_date || "";
        }
      }

      // 금회 측정 확정일 포맷팅
      let measurementDateFormatted = "";
      if (business.measurement_date) {
        try {
          const date = new Date(business.measurement_date);
          measurementDateFormatted = date.toISOString().split("T")[0];
        } catch {
          measurementDateFormatted = business.measurement_date;
        }
      }

      // 측정월: 금회측정확정일의 월, 없으면 금회예정일의 월
      let measurementMonth = "";
      if (business.measurement_date) {
        try {
          measurementMonth = `${new Date(business.measurement_date).getMonth() + 1}월`;
        } catch { }
      } else if (business.future_measurement_date) {
        try {
          measurementMonth = `${new Date(business.future_measurement_date).getMonth() + 1}월(예정)`;
        } catch { }
      }

      return {
        코드: business.code || "",
        국고결과: nationalSupportStatus || "",
        계획담당자: business.measurer || "",
        전회측정일: previousMeasurementDateFormatted,
        "전회 측정 주기": business.future_measurement_period ? `${business.future_measurement_period}개월` : "",
        금회예정일: futureMeasurementDateFormatted || "",
        금회측정확정일: measurementDateFormatted,
        측정월: measurementMonth,
        업종분류: businessCategory || "",
        사업장명: business.business_name || "",
        주소: business.address || "",
        "소재지 관할청": business.office_jurisdiction || "",
        담당자명: business.manager_name || "",
        "담당자 휴대폰": business.manager_mobile || "",
        회사전화번호: business.manager_phone || "",
        비고: business.notes || "",
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
