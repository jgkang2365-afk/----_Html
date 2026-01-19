import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 직전 측정일지 데이터 조회 API
 * GET /api/journal/previous-data?code=XXX&year=2025&period=상반기
 * 같은 code의 직전 연도/주기 측정일지 데이터를 반환
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    if (!code || !year || !period) {
      return NextResponse.json(
        { error: "code, year, period 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const measurementYear = parseInt(year);
    const supabase = await createClient();

    // 주기 순서: 하반기 > 상반기
    const periodOrder: { [key: string]: number } = { "하반기": 2, "상반기": 1 };
    const currentPeriodOrder = periodOrder[period] || 0;

    // 같은 code의 직전 측정일지 찾기
    // 우선순위: 같은 연도 직전 주기 > 작년 반대 주기 > 작년 같은 주기 > 그 이전 연도들
    // 직전의 자료를 찾아야 변경되거나 수정된 업데이트된 최신 자료를 가져올 수 있기 때문
    // 예: 2026년 하반기 입력 → 2026년 상반기 조회 → 2025년 하반기 조회 → 2025년 상반기 조회
    let previousJournal = null;

    // 1순위: 같은 연도에서 직전 주기
    if (period === "하반기") {
      // 하반기 입력 시 -> 같은 연도 상반기
      const { data } = await supabase
        .from("measurement_journal")
        .select("*")
        .eq("code", code)
        .eq("measurement_year", measurementYear)
        .eq("measurement_period", "상반기")
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      previousJournal = data;
    }

    // 2순위: 작년 반대 주기 (산재관리번호는 직전 측정일지에만 있으므로 우선 확인)
    if (!previousJournal) {
      const oppositePeriod = period === "상반기" ? "하반기" : "상반기";
      const { data, error } = await supabase
        .from("measurement_journal")
        .select("*")
        .eq("code", code)
        .eq("measurement_year", measurementYear - 1)
        .eq("measurement_period", oppositePeriod)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('[previous-data API] 작년 반대 주기 조회 오류:', error);
      }
      
      if (data) {
        console.log('[previous-data API] 작년 반대 주기 조회 결과:', {
          id: data.id,
          year: data.measurement_year,
          period: data.measurement_period,
          industrial_accident_number: data.industrial_accident_number,
        });
        previousJournal = data;
      }
    }

    // 3순위: 작년 같은 주기
    if (!previousJournal) {
      const { data } = await supabase
        .from("measurement_journal")
        .select("*")
        .eq("code", code)
        .eq("measurement_year", measurementYear - 1)
        .eq("measurement_period", period)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      previousJournal = data;
    }

    // 4순위: 그 이전 연도들 (최대 3년 전까지)
    if (!previousJournal) {
      for (let y = measurementYear - 2; y >= measurementYear - 4; y--) {
        const { data } = await supabase
          .from("measurement_journal")
          .select("*")
          .eq("code", code)
          .eq("measurement_year", y)
          .order("measurement_period", { ascending: false })
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) {
          previousJournal = data;
          break;
        }
      }
    }

    // 국고지원 정보 조회 (national_support_application 테이블)
    const { data: nationalSupportData } = await supabase
      .from("national_support_application")
      .select("*")
      .eq("code", code)
      .eq("year", measurementYear)
      .eq("period", period)
      .maybeSingle();

    // measurement_summary에서 요약 정보 조회 (같은 code의 최신 항목)
    const { data: summaryData } = await supabase
      .from("measurement_summary")
      .select("*")
      .eq("code", code)
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // measurement_business에서 국고지원 정보 및 산재관리번호 조회
    const { data: businessData } = await supabase
      .from("measurement_business")
      .select("national_support_status, industrial_accident_number")
      .eq("code", code)
      .eq("year", measurementYear)
      .eq("period", period)
      .maybeSingle();

    // 예비조사 정보 조회 (같은 code의 가장 최근 예비조사)
    const { data: latestSurvey } = await supabase
      .from("preliminary_survey")
      .select("preliminary_surveyor, measurer, survey_code, actual_measurer, report_writer, measurement_date")
      .eq("code", code)
      .order("measurement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 국고지원 상태 결정 우선순위:
    // 1. national_support_application 테이블
    // 2. measurement_business 테이블
    // 3. 직전 측정일지
    let nationalSupportStatus = null;
    if (nationalSupportData?.national_support_status) {
      nationalSupportStatus = nationalSupportData.national_support_status;
    } else if (businessData?.national_support_status) {
      nationalSupportStatus = businessData.national_support_status;
    } else if (previousJournal?.national_support_status) {
      nationalSupportStatus = previousJournal.national_support_status;
    }

    if (!previousJournal && !nationalSupportData && !summaryData) {
      return NextResponse.json({
        previousData: null,
        nationalSupportStatus,
        message: "직전 측정일지 데이터가 없습니다.",
      });
    }

    // 디버깅: 직전 측정일지 데이터 확인
    if (previousJournal) {
      console.log('[previous-data API] 직전 측정일지 조회 결과:', {
        id: previousJournal.id,
        code: previousJournal.code,
        measurement_year: previousJournal.measurement_year,
        measurement_period: previousJournal.measurement_period,
        industrial_accident_number: previousJournal.industrial_accident_number,
        industrial_accident_number_type: typeof previousJournal.industrial_accident_number,
        industrial_accident_number_raw: JSON.stringify(previousJournal.industrial_accident_number),
        has_industrial_accident_number: previousJournal.hasOwnProperty('industrial_accident_number'),
        all_keys: Object.keys(previousJournal).filter(k => k.includes('industrial') || k.includes('accident')),
      });
      
      // 같은 code의 모든 측정일지 확인 (디버깅용)
      const { data: allJournals } = await supabase
        .from("measurement_journal")
        .select("id, measurement_year, measurement_period, industrial_accident_number")
        .eq("code", code)
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false });
      console.log('[previous-data API] 같은 code의 모든 측정일지:', allJournals?.map(j => ({
        id: j.id,
        year: j.measurement_year,
        period: j.measurement_period,
        industrial_accident_number: j.industrial_accident_number,
      })));
    }
    
    // 직전 측정일지에서 자동 채울 수 있는 필드만 반환
    // 산재관리번호는 measurement_journal에 없으면 measurement_business에서 가져오기
    const previousData = previousJournal ? {
      // 담당자 정보
      manager_name: previousJournal.manager_name || null,
      manager_position: previousJournal.manager_position || null,
      manager_mobile: previousJournal.manager_mobile || null,
      manager_email: previousJournal.manager_email || null,
      
      // 측정비 정보
      measurement_fee_business: previousJournal.measurement_fee_business || null,
      measurement_fee_national: previousJournal.measurement_fee_national || null,
      
      // 이메일 정보
      invoice_email: previousJournal.invoice_email || null,
      
      // 측정자
      measurer: previousJournal.measurer || null,
      
      // K2B 전송자
      k2b_sender: previousJournal.k2b_sender || null,
      
      // 산재관리번호 (measurement_journal에 없으면 measurement_business에서 가져오기)
      industrial_accident_number: previousJournal.industrial_accident_number || businessData?.industrial_accident_number || null,
    } : null;
    
    // 디버깅: previousData 확인
    if (previousData) {
      console.log('[previous-data API] previousData 산재관리번호:', previousData.industrial_accident_number);
    }

    // measurement_summary에서 추가 정보 가져오기
    const summaryInfo = summaryData ? {
      manager_name: summaryData.manager_name || null,
      manager_mobile: summaryData.manager_mobile || null,
      manager_email: summaryData.manager_email || null,
      measurement_fee_business: summaryData.measurement_fee_business || null,
      k2b_sender: summaryData.k2b_sender || null,
    } : null;

    // 예비조사 정보
    // report_writer는 콤마 구분 문자열일 수 있으므로 첫 번째 값만 사용
    const surveyInfo = latestSurvey ? {
      preliminary_surveyor: latestSurvey.preliminary_surveyor || null,
      measurer: latestSurvey.measurer || null,
      survey_code: latestSurvey.survey_code || null,
      actual_measurer: latestSurvey.actual_measurer || null,
      report_writer: latestSurvey.report_writer 
        ? (latestSurvey.report_writer.includes(',') 
            ? latestSurvey.report_writer.split(',').map((w: string) => w.trim()).filter(Boolean)[0] 
            : latestSurvey.report_writer.trim())
        : null,
      measurement_date: latestSurvey.measurement_date || null,
    } : null;

    return NextResponse.json({
      previousData,
      nationalSupportStatus,
      summaryInfo,
      surveyInfo,
      source: previousJournal ? {
        year: previousJournal.measurement_year,
        period: previousJournal.measurement_period,
      } : null,
    });
  } catch (error) {
    console.error("직전 측정일지 데이터 조회 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "직전 측정일지 데이터 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
