import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";
import { exportRow, headersFor } from "@/lib/excel-contract/contract";
import { measurementTargetFields } from "@/lib/excel-contract/measurement-target";
import { resolveTargetBusinessCategory } from "@/lib/business/target-classification";
import { getTargetBusinessTypeLabel } from "@/lib/business/target-business-form";
import { toShortName } from "@/lib/constants/designated-offices";
import { normalizeBusinessStatus } from "@/lib/utils/sync-helper";

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
    const unpaidMap = new Map<string, { regular: number; adHoc: number }>();
    const reportWriterMap = new Map<number, string>();
    const latestCategoryMap = new Map<string, string | null>();
    const latestJournalCategoryMap = new Map<string, string | null>();

    if (codes.length > 0) {
      const [{ data: receivables }, { data: users }, { data: latestBusinesses }, { data: latestJournals }] = await Promise.all([
        supabase.from("measurement_journal").select("code, measurement_period, measurement_fee_business, deposit_amount_business, deposit_amount_business_2, measurement_fee_national, deposit_amount_national").in("code", codes),
        supabase.from("users").select("id, name"),
        supabase.from("measurement_business").select("code, year, period, business_category").in("code", codes).order("year", { ascending: false }).order("period", { ascending: false }),
        supabase.from("measurement_journal").select("code, measurement_year, measurement_period, business_category").in("code", codes).order("measurement_year", { ascending: false }).order("measurement_period", { ascending: false }),
      ]);
      (receivables || []).forEach((item: any) => {
        const count = Number(item.measurement_fee_business || 0) > Number(item.deposit_amount_business || 0) + Number(item.deposit_amount_business_2 || 0)
          ? 1 : 0;
        const nationalCount = Number(item.measurement_fee_national || 0) > Number(item.deposit_amount_national || 0) ? 1 : 0;
        const current = unpaidMap.get(item.code) || { regular: 0, adHoc: 0 };
        const kind = String(item.measurement_period || "").includes("(수시)") ? "adHoc" : "regular";
        current[kind] += count + nationalCount;
        unpaidMap.set(item.code, current);
      });
      (users || []).forEach((user: any) => reportWriterMap.set(Number(user.id), String(user.name)));
      (latestBusinesses || []).forEach((item: any) => {
        if (!latestCategoryMap.has(item.code)) latestCategoryMap.set(item.code, item.business_category || null);
      });
      (latestJournals || []).forEach((item: any) => {
        if (!latestJournalCategoryMap.has(item.code)) latestJournalCategoryMap.set(item.code, item.business_category || null);
      });
    }

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
      // 측정대상 목록의 현재 대상 상태를 우선한다.
      const nationalSupportKey = `${business.code}-${business.year}-${business.period}`;
      let nationalSupportStatus =
        business.national_support_status ||
        nationalSupportMap.get(nationalSupportKey) ||
        journalNationalSupportMap.get(nationalSupportKey) ||
        null;

      // '지원' 용어를 '대상'으로 통일
      if (nationalSupportStatus === "지원" || nationalSupportStatus === "지원대상") {
        nationalSupportStatus = "대상";
      } else if (nationalSupportStatus === "미지원") {
        nationalSupportStatus = "비대상";
      }

      // business_category 조회
      const businessCategory = resolveTargetBusinessCategory(
        business.business_category,
        latestCategoryMap.get(business.code),
        latestJournalCategoryMap.get(business.code) || businessCategoryMap.get(nationalSupportKey) || null,
      );

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

      return exportRow(measurementTargetFields, {
        ...business,
        is_registered: normalizeBusinessStatus(business.is_registered),
        national_support_status: nationalSupportStatus,
        plan_manager: business.plan_manager || business.measurer,
        business_category: businessCategory,
        business_type: business.business_type ? getTargetBusinessTypeLabel(business.business_type) : "",
        office_jurisdiction: toShortName(business.office_jurisdiction || ""),
        unpaid_count: unpaidMap.get(business.code)?.[String(business.period).includes("(수시)") ? "adHoc" : "regular"] || 0,
        previous_measurement_date: business.previous_measurement_date || previousMeasurementDateFormatted,
        measurement_month: business.measurement_month || measurementMonth,
        future_measurement_date: futureMeasurementDateFormatted,
        report_writer: business.measurer_id ? reportWriterMap.get(Number(business.measurer_id)) || "" : "",
        measurement_date: measurementDateFormatted,
        phone: business.phone || business.manager_phone,
      });
    });

    // 엑셀 워크북 생성
    const worksheet = XLSX.utils.json_to_sheet(excelData, { header: headersFor(measurementTargetFields, "export") });
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
