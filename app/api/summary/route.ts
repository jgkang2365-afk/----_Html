
import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { toShortName } from "@/lib/constants/designated-offices";

/**
 * 측정정보 요약 조회 API
 * 측정일지와 예비조사 정보를 조인하여 반환
 * GET /api/summary
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const measurementYear = searchParams.get("measurementYear")?.trim() || null;
    const measurementPeriod = searchParams.get("measurementPeriod")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;

    const supabase = await createClient();

    // 측정일지 조회
    let journalQuery = supabase
      .from("measurement_journal")
      .select("*")
      .not("business_name", "ilike", "%번외%");

    // 정렬 적용
    if (!measurementYear) {
      // 년도 전체일 때: 시간 역순 (년도 DESC, 주기 DESC, 등록순 DESC)
      journalQuery = journalQuery
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .order("document_number", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      // 년도 선택 시: 기존 정렬 유지
      journalQuery = journalQuery
        .order("document_number", { ascending: false })
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .order("created_at", { ascending: false });
    }

    // 검색 조건 적용
    if (measurementYear) {
      if (measurementYear.includes(",")) {
        const years = measurementYear.split(",").map(y => parseInt(y.trim())).filter(y => !isNaN(y));
        if (years.length > 0) {
          journalQuery = journalQuery.in("measurement_year", years);
        }
      } else {
        journalQuery = journalQuery.eq("measurement_year", parseInt(measurementYear));
      }
    }

    if (measurementPeriod) {
      if (measurementPeriod.includes(",")) {
        const periods = measurementPeriod.split(",").map(p => p.trim()).filter(Boolean);
        if (periods.length > 0) {
          const orFilter = periods.map(p => `measurement_period.ilike.%${p}%`).join(",");
          journalQuery = journalQuery.or(orFilter);
        }
      } else {
        journalQuery = journalQuery.ilike("measurement_period", `%${measurementPeriod}%`);
      }
    }

    if (businessName) {
      if (businessName.includes(",")) {
        const names = businessName.split(",").map(n => n.trim()).filter(Boolean);
        if (names.length > 0) {
          const orFilter = names.map(name => `business_name.ilike.%${name}%`).join(",");
          journalQuery = journalQuery.or(orFilter);
        }
      } else {
        journalQuery = journalQuery.ilike("business_name", `%${businessName}%`);
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
        journalQuery = journalQuery.in("designated_office", allOffices);
      }
    }

    // 측정일 (측정시작일 기준)
    const measurementDate = searchParams.get("measurementDate")?.trim() || null;
    if (measurementDate) {
      journalQuery = journalQuery.eq("measurement_start_date", measurementDate);
    }

    const { data: journals, error: journalError } = await journalQuery;

    if (journalError) {
      console.error("측정일지 조회 오류:", journalError);
      return NextResponse.json(
        { error: "측정정보를 불러오는 중 오류가 발생했습니다.", details: journalError.message },
        { status: 500 }
      );
    }

    // 측정일지의 code 목록 추출
    const codes = (journals || [])
      .map((j: any) => j.code)
      .filter((code: string | null) => code !== null && code !== undefined);

    // 예비조사 정보 조회 (code 기준)
    let surveys: any[] = [];
    if (codes.length > 0) {
      const { data: surveyData, error: surveyError } = await supabase
        .from("preliminary_survey")
        .select("id, code, measurement_date, end_date, measurement_weekdays, preliminary_surveyor, actual_measurer, report_writer, survey_code, created_at")
        .in("code", codes);

      if (surveyError) {
        console.error("예비조사 조회 오류:", surveyError);
        // 예비조사 조회 실패해도 계속 진행
      } else {
        surveys = surveyData || [];
      }
    }

    // 측정사업장 정보 조회 (개시번호, 담당자 정보, 계산서 이메일 가져오기)
    let measurementBusinesses: any[] = [];
    if (codes.length > 0) {
      let { data: mbData, error: mbError } = await supabase
        .from("measurement_business")
        .select("code, year, period, representative_name, commencement_number, manager_name, manager_position, manager_mobile, manager_phone, manager_email, invoice_email")
        .in("code", codes)
        .order("year", { ascending: false })
        .order("period", { ascending: false });

      if (mbError && (mbError.message?.includes("manager_phone") || mbError.code === "PGRST204")) {
        const fallbackResult = await supabase
          .from("measurement_business")
          .select("code, year, period, representative_name, commencement_number, manager_name, manager_position, manager_mobile, manager_email, invoice_email")
          .in("code", codes)
          .order("year", { ascending: false })
          .order("period", { ascending: false });

        mbData = fallbackResult.data;
        mbError = fallbackResult.error;
      }

      if (mbError) {
        console.warn("측정사업장 조회 오류 (개시번호 및 담당자):", mbError);
      } else {
        measurementBusinesses = mbData || [];
      }
    }

    // 측정사업장 맵 생성: 현재 연도/주기 정확 매칭을 우선하고, 없을 때만 코드별 최신 이력을 사용
    const mbExactMap = new Map<string, any>();
    const mbLatestMap = new Map<string, any>();
    measurementBusinesses.forEach((mb) => {
      if (mb.code) {
        mbExactMap.set(`${mb.code}-${mb.year}-${mb.period}`, mb);
        if (!mbLatestMap.has(mb.code)) {
          mbLatestMap.set(mb.code, mb);
        }
      }
    });

    // 사업장 정보(business_info) 조회 (대표자명 가져오기)
    let businessInfos: any[] = [];
    if (codes.length > 0) {
      let { data: biData, error: biError } = await supabase
        .from("business_info")
        .select("code, representative_name, total_employees")
        .in("code", codes);

      if (biError) {
        console.warn("사업장 정보 조회 오류 (대표자명):", biError);
      } else {
        businessInfos = biData || [];
      }
    }

    // code를 키로 하는 사업장 정보 맵 생성
    const biMap = new Map<string, any>();
    businessInfos.forEach((bi) => {
      if (bi.code) {
        biMap.set(bi.code, bi);
      }
    });

    // 2026-02-06 Fix: Fetch measurement_target_business for national_support_status
    let targets: any[] = [];
    if (codes.length > 0) {
      const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("code, year, period, national_support_status, measurement_date, plan_manager")
        .in("code", codes);

      if (targetError) {
        console.warn("대상 사업장 조회 오류 (국고지원여부):", targetError);
      } else {
        targets = targetData || [];
      }
    }

    // 예비조사 정보를 조인하여 요약 데이터 생성
    const normalizePhoneLikeValue = (value: any, managerName?: any) => {
      const text = String(value || "").trim();
      if (!text) return null;

      const nameText = String(managerName || "").trim();
      const digitCount = (text.match(/\d/g) || []).length;
      const containsKorean = /[가-힣]/.test(text);

      if (nameText && text === nameText) return null;
      if (containsKorean && digitCount < 7) return null;
      if (digitCount > 0 && digitCount < 7) return null;

      return text;
    };

    const findFirstPhoneLikeValue = (managerName: any, ...values: any[]) => {
      for (const value of values) {
        const normalized = normalizePhoneLikeValue(value, managerName);
        if (normalized) return normalized;
      }
      return null;
    };

    const summaryData = (journals || []).map((journal: any) => {
      const exactKey = `${journal.code}-${journal.measurement_year}-${journal.measurement_period}`;
      const mb = journal.code ? (mbExactMap.get(exactKey) || mbLatestMap.get(journal.code)) : null;
      const bi = journal.code ? biMap.get(journal.code) : null;

      // 해당 코드의 모든 예비조사 필터링 (다중 일자 지원을 위해 목록 전체 유지)
      const businessSurveys = surveys.filter(s => s.code === journal.code);

      // 현재 저널의 주기(year, period)와 일치하는 예비조사만 필터링
      const relatedSurveys = businessSurveys.filter(s => {
        if (!s.measurement_date) return false;
        const sDate = new Date(s.measurement_date);
        const sYear = sDate.getFullYear();
        const sMonth = sDate.getMonth() + 1;
        const sPeriod = sMonth <= 6 ? "상반기" : "하반기";
        return sYear === journal.measurement_year && (journal.measurement_period.includes(sPeriod));
      });

      // 기존 UI 호환성을 위한 대표 survey (첫 번째 항목)
      const survey = relatedSurveys.length > 0 ? relatedSurveys[0] : null;

      // Find target for National Support Status fallback
      let target = targets.find(t =>
        t.code === journal.code &&
        t.year === journal.measurement_year &&
        t.period === journal.measurement_period
      );

      // 2. Loose match (if strictly not found) - handle "(수시)" etc.
      if (!target) {
        target = targets.find(t =>
          t.code === journal.code &&
          t.year === journal.measurement_year &&
          (t.period.includes(journal.measurement_period) || journal.measurement_period.includes(t.period))
        );
      }

      const nationalSupportStatus = journal.national_support_status || target?.national_support_status || null;
      const managerName = journal.manager_name || mb?.manager_name || null;

      return {
        id: journal.id,
        journal_id: journal.id,
        survey_id: survey?.id || null,
        all_surveys: relatedSurveys, // [New] 연관된 모든 예비조사 목록 추가
        code: journal.code,
        measurement_year: journal.measurement_year,
        measurement_period: journal.measurement_period,
        note: journal.note,
        document_number: journal.document_number,
        sequence_number: journal.sequence_number,
        five_plus_sequence: journal.five_plus_sequence,
        measurement_start_date: journal.measurement_start_date,
        measurement_end_date: journal.measurement_end_date,
        measurement_days: journal.measurement_days,
        measurer: journal.measurer,
        preliminary_surveyor: survey?.preliminary_surveyor || null,
        actual_measurer: survey?.actual_measurer || null,
        report_writer: survey?.report_writer || null,
        survey_code: survey?.survey_code || null,
        survey_measurement_date: survey?.measurement_date || null,
        survey_end_date: survey?.end_date || null,
        survey_measurement_weekdays: survey?.measurement_weekdays || null,
        office_jurisdiction: journal.office_jurisdiction,
        designated_office: journal.designated_office ? toShortName(journal.designated_office) : null,
        business_name: journal.business_name,
        representative_name: journal.representative_name || mb?.representative_name || bi?.representative_name || null,
        total_employees: (() => {
          const val = journal.total_employees ?? mb?.total_employees ?? bi?.total_employees;
          if (val === null || val === undefined) return null;
          const num = typeof val === 'string' ? parseInt(val.replace(/,/g, "")) : val;
          return isNaN(num as any) ? val : num;
        })(),
        business_number: journal.business_number,
        industrial_accident_number: journal.industrial_accident_number,
        commencement_number: journal.commencement_number || mb?.commencement_number || bi?.commencement_number || null,
        national_support_status: nationalSupportStatus,
        manager_name: managerName,
        manager_position: journal.manager_position || mb?.manager_position || null,
        manager_mobile: findFirstPhoneLikeValue(managerName, journal.manager_mobile, mb?.manager_mobile, mb?.manager_phone),
        manager_email: journal.manager_email || mb?.manager_email || null,
        invoice_email: journal.invoice_email || mb?.invoice_email || null,
        invoice_email_2: journal.invoice_email_2,
        address: journal.address,
        phone: journal.phone,
        fax: journal.fax,
        k2b_send_date: journal.k2b_send_date,
        k2b_sender: journal.k2b_sender,
        electronic_invoice_date: journal.electronic_invoice_date,
        electronic_invoice_date_2: journal.electronic_invoice_date_2,
        deposit_amount_business: journal.deposit_amount_business,
        deposit_date_business: journal.deposit_date_business,
        deposit_amount_business_2: journal.deposit_amount_business_2,
        deposit_date_business_2: journal.deposit_date_business_2,
        measurement_fee_business: journal.measurement_fee_business,
        measurement_fee_national: journal.measurement_fee_national,
        special_notes: journal.special_notes,
        completion_status: journal.completion_status,
        target_measurement_date: target?.measurement_date || null,
        plan_manager: target?.plan_manager || null,
        created_at: journal.created_at,
        updated_at: journal.updated_at,
      };
    });

    // 보고서 담당자 필터링 (메모리 상에서 처리)
    const reportWriter = searchParams.get("reportWriter")?.trim() || null;
    let finalData = summaryData;

    if (reportWriter) {
      finalData = finalData.filter((item: any) => item.report_writer === reportWriter);
    }

    return NextResponse.json({
      success: true,
      data: finalData,
      count: finalData.length,
    });
  } catch (error: any) {
    console.error("측정정보 요약 조회 오류:", error);
    return NextResponse.json(
      { error: error.message || "측정정보를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
