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
      journalQuery = journalQuery.eq("measurement_year", parseInt(measurementYear));
    }

    if (measurementPeriod) {
      journalQuery = journalQuery.eq("measurement_period", measurementPeriod);
    }

    if (businessName) {
      journalQuery = journalQuery.ilike("business_name", `%${businessName}%`);
    }

    if (designatedOffice) {
      // 약칭으로 정규화하여 검색 (기존 전체명과 호환)
      const normalizedOffice = toShortName(designatedOffice);
      // 기존 전체명과 약칭 모두 매칭 (.in() 사용하여 더 안전하게 처리)
      const officesToMatch = [normalizedOffice];
      if (normalizedOffice !== designatedOffice) {
        officesToMatch.push(designatedOffice);
      }
      journalQuery = journalQuery.in("designated_office", officesToMatch);
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

    // code를 키로 하는 예비조사 맵 생성 (가장 최신 것만 사용)
    const surveyMap = new Map<string, any>();
    surveys.forEach((survey) => {
      if (survey.code) {
        const existing = surveyMap.get(survey.code);
        if (!existing || new Date(survey.created_at) > new Date(existing.created_at)) {
          surveyMap.set(survey.code, survey);
        }
      }
    });

    // 예비조사 정보를 조인하여 요약 데이터 생성
    const summaryData = (journals || []).map((journal: any) => {
      const survey = journal.code ? surveyMap.get(journal.code) : null;

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
        national_support_status: journal.national_support_status,
        manager_name: journal.manager_name,
        manager_position: journal.manager_position,
        manager_mobile: journal.manager_mobile,
        manager_email: journal.manager_email,
        address: journal.address,
        phone: journal.phone,
        fax: journal.fax,
        k2b_send_date: journal.k2b_send_date,
        k2b_sender: journal.k2b_sender,
        measurement_fee_business: journal.measurement_fee_business,
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
