
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
      .not("business_name", "ilike", "%번외%")
      .order("document_number", { ascending: false })
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("created_at", { ascending: false });

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
      const { data: mbData, error: mbError } = await supabase
        .from("measurement_business")
        .select("code, representative_name, commencement_number, manager_name, manager_position, manager_mobile, manager_email, invoice_email")
        .in("code", codes);

      if (mbError) {
        console.warn("측정사업장 조회 오류 (개시번호 및 담당자):", mbError);
      } else {
        measurementBusinesses = mbData || [];
      }
    }

    // code를 키로 하는 측정사업장 맵 생성
    const mbMap = new Map<string, any>();
    measurementBusinesses.forEach((mb) => {
      if (mb.code) {
        mbMap.set(mb.code, mb);
      }
    });

    // 사업장 정보(business_info) 조회 (대표자명 가져오기)
    let businessInfos: any[] = [];
    if (codes.length > 0) {
      const { data: biData, error: biError } = await supabase
        .from("business_info")
        .select("code, representative_name, commencement_number, total_employees")
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
        .select("code, year, period, national_support_status, measurement_date")
        .in("code", codes);

      if (targetError) {
        console.warn("대상 사업장 조회 오류 (국고지원여부):", targetError);
      } else {
        targets = targetData || [];
      }
    }

    // 예비조사 정보를 조인하여 요약 데이터 생성
    const summaryData = (journals || []).map((journal: any) => {
      // 해당 측정일지의 년도와 주기에 맞는 예비조사 찾기
      const journalYear = journal.measurement_year;
      const journalPeriod = journal.measurement_period; // "상반기" or "하반기"

      // 해당 코드의 모든 예비조사 필터링
      const businessSurveys = surveys.filter(s => s.code === journal.code);

      // 기간이 일치하는 예비조사 찾기
      let survey = businessSurveys.find(s => {
        if (!s.measurement_date) return false;
        const sDate = new Date(s.measurement_date);
        const sYear = sDate.getFullYear();
        const sMonth = sDate.getMonth() + 1;
        const sPeriod = sMonth <= 6 ? "상반기" : "하반기";

        return sYear === journalYear && (journalPeriod.includes(sPeriod));
      });

      // 만약 기간 일치 항목이 없으면 가장 최근 것 사용 (기존 로직 주석 처리 또는 제거)
      // 변경(2025.02.21): 과거 데이터(24년, 25년 초)가 표시되어 혼동을 주는 문제로 인해 일치하는 주기가 없으면 null 처리
      // if (!survey && businessSurveys.length > 0) {
      //   survey = businessSurveys.sort((a, b) =>
      //     new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      //   )[0];
      // }

      const mb = journal.code ? mbMap.get(journal.code) : null;
      const bi = journal.code ? biMap.get(journal.code) : null;

      // Find target for National Support Status fallback
      // Strict match on code, year, period
      // 1. Strict match on code, year, period
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

      // Priority: Journal > Target
      const nationalSupportStatus = journal.national_support_status || target?.national_support_status || null;

      return {
        id: journal.id,
        journal_id: journal.id,
        survey_id: survey?.id || null,
        code: journal.code,
        measurement_year: journal.measurement_year,
        measurement_period: journal.measurement_period,
        note: journal.note,
        document_number: journal.document_number, // 수정 불가
        sequence_number: journal.sequence_number, // 수정 불가
        five_plus_sequence: journal.five_plus_sequence, // 수정 불가
        measurement_start_date: journal.measurement_start_date,
        measurement_end_date: journal.measurement_end_date,
        measurer: journal.measurer,
        preliminary_surveyor: survey?.preliminary_surveyor || null,
        actual_measurer: survey?.actual_measurer || null,
        report_writer: survey?.report_writer || null,
        survey_code: survey?.survey_code || null,
        survey_measurement_date: survey?.measurement_date || null,
        survey_end_date: survey?.end_date || null,
        survey_measurement_weekdays: survey?.measurement_weekdays || null,
        office_jurisdiction: journal.office_jurisdiction,
        designated_office: journal.designated_office ? toShortName(journal.designated_office) : null, // 약칭으로 변환
        business_name: journal.business_name,
        representative_name: journal.representative_name || mb?.representative_name || bi?.representative_name || null, // 대표자명 우선순위: Journal > MB > BI
        total_employees: (() => {
          const val = journal.total_employees ?? mb?.total_employees ?? bi?.total_employees;
          if (val === null || val === undefined) return null;
          const num = typeof val === 'string' ? parseInt(val.replace(/,/g, "")) : val;
          return isNaN(num as any) ? val : num;
        })(),
        business_number: journal.business_number,
        industrial_accident_number: journal.industrial_accident_number,
        commencement_number: journal.commencement_number || mb?.commencement_number || bi?.commencement_number || null, // 개시번호는 빈 문자열일 수 있으므로 || 유지 또는 취사선택
        national_support_status: nationalSupportStatus,
        manager_name: journal.manager_name || mb?.manager_name || null, // 담당자명 fallback
        manager_position: journal.manager_position || mb?.manager_position || null, // 직위 fallback
        manager_mobile: journal.manager_mobile || mb?.manager_mobile || null, // 휴대폰 fallback
        manager_email: journal.manager_email || mb?.manager_email || null, // 이메일 fallback
        invoice_email: journal.invoice_email || mb?.invoice_email || null, // 계산서 이메일 fallback
        invoice_email_2: journal.invoice_email_2,
        address: journal.address,
        phone: journal.phone,
        fax: journal.fax,
        k2b_send_date: journal.k2b_send_date,
        k2b_sender: journal.k2b_sender,
        electronic_invoice_date: journal.electronic_invoice_date,
        measurement_fee_business: journal.measurement_fee_business,
        special_notes: journal.special_notes,
        completion_status: journal.completion_status,
        target_measurement_date: target?.measurement_date || null,
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
