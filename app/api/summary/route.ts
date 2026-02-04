import { NextRequest, NextResponse } from "next/server";
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

    // 측정사업장 정보 조회 (개시번호 가져오기)
    let measurementBusinesses: any[] = [];
    if (codes.length > 0) {
      const { data: mbData, error: mbError } = await supabase
        .from("measurement_business")
        .select("code, commencement_number")
        .in("code", codes);

      if (mbError) {
        console.warn("측정사업장 조회 오류 (개시번호):", mbError);
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

      // 만약 기간 일치 항목이 없으면 가장 최근 것 사용 (기존 로직 유지)
      if (!survey && businessSurveys.length > 0) {
        survey = businessSurveys.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];
      }

      const mb = journal.code ? mbMap.get(journal.code) : null;

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
        total_employees: journal.total_employees,
        business_number: journal.business_number,
        industrial_accident_number: journal.industrial_accident_number,
        commencement_number: mb?.commencement_number || null, // 개시번호 추가
        national_support_status: journal.national_support_status,
        manager_name: journal.manager_name,
        manager_position: journal.manager_position,
        manager_mobile: journal.manager_mobile,
        manager_email: journal.manager_email,
        invoice_email: journal.invoice_email,
        address: journal.address,
        phone: journal.phone,
        fax: journal.fax,
        k2b_send_date: journal.k2b_send_date,
        k2b_sender: journal.k2b_sender,
        measurement_fee_business: journal.measurement_fee_business,
        special_notes: journal.special_notes,
        completion_status: journal.completion_status,
        created_at: journal.created_at,
        updated_at: journal.updated_at,
      };
    });

    return NextResponse.json({
      success: true,
      data: summaryData,
      count: summaryData.length,
    });
  } catch (error: any) {
    console.error("측정정보 요약 조회 오류:", error);
    return NextResponse.json(
      { error: error.message || "측정정보를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
