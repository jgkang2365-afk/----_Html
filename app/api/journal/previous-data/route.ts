import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
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

    const trimmedCode = code.trim();
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

    // Fallback: 특정 시점의 직전 데이터가 없거나, 있더라도 중요 필드(산재관리번호, 이메일 등)가 비어있다면
    // 최근 5개 데이터를 조회하여 채워넣음
    let fallbackDefaults: Record<string, any> = {};
    const { data: recentJournals } = await supabase
      .from("measurement_journal")
      .select("manager_name, manager_mobile, manager_email, manager_position, phone, fax, invoice_email, industrial_accident_number, commencement_number, measurement_year, measurement_period")
      .eq("code", trimmedCode)
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .limit(5);

    if (recentJournals && recentJournals.length > 0) {
      const fieldsToFind = [
        "manager_name", "manager_mobile", "manager_email",
        "manager_position", "phone", "fax",
        "invoice_email", "industrial_accident_number", "commencement_number",
        "representative_name"
      ];

      for (const field of fieldsToFind) {
        for (const journal of recentJournals) {
          // [PATCH] 현재 수정 중인 연도/주기와 동일한 레코드는 제외
          if (journal.measurement_year === measurementYear && journal.measurement_period === period) {
            continue;
          }

          // journal을 safe하게 접근
          const val = (journal as any)[field];
          if (val && !fallbackDefaults[field]) {
            fallbackDefaults[field] = val;
            break;
          }
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

    // [NEW] Best Reference Data (Shared Logic)
    // 측정일지 등록/수정 시 빈 필드를 채울 최적의 참조 데이터
    const { getBestReferenceData } = await import("@/lib/business/reference-data");
    const referenceData = await getBestReferenceData(supabase, code, measurementYear, period);
    
    // [NEW] 전회 데이터 레이블용 (현재 주기 제외)
    const historyReferenceData = await getBestReferenceData(supabase, code, measurementYear, period, { excludeCurrent: true });

    // measurement_business에서 국고지원 정보 및 산재관리번호 조회 (현재 시점 데이터)
    // -> getBestReferenceData로 대체되었으나, 기존 로직 호환성을 위해 유지하거나 referenceData 사용
    const businessData = referenceData.source_type !== 'none' ? referenceData : null;

    // 5순위: measurement_business 과거 이력 조회 (최신순)
    // -> getBestReferenceData 내부 로직으로 대체됨.
    // 하지만 기존 변수 명(businessHistoryDefaults)을 사용하는 로직이 아래에 있으므로,
    // referenceData를 사용하여 매핑하거나, 아래 로직을 referenceData 기반으로 수정해야 함.

    // 여기서는 기존 로직(previousJournal 중심)을 유지하되, fallback으로 referenceData를 적극 활용하도록 수정

    // 예비조사 정보 조회 (해당 연도/주기 전체 목록)
    const { data: periodSurveys } = await supabase
      .from("preliminary_survey")
      .select("preliminary_surveyor, measurer, survey_code, actual_measurer, report_writer, measurement_date")
      .eq("code", code)
      .eq("year", measurementYear)
      .eq("period", period)
      .order("measurement_date", { ascending: true });

    // 전반적인 fallback을 위해 가장 최근 것도 필요할 수 있음 (기존 호환성)
    const { data: latestSurvey } = await supabase
      .from("preliminary_survey")
      .select("preliminary_surveyor, measurer, survey_code, actual_measurer, report_writer, measurement_date")
      .eq("code", code)
      .order("measurement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const surveys = periodSurveys || [];

    // 국고지원 상태 결정 우선순위:
    // 1. national_support_application 테이블
    // 2. measurement_business 테이블
    // 3. 직전 측정일지
    let nationalSupportStatus = null;
    if (nationalSupportData?.national_support_status) {
      nationalSupportStatus = nationalSupportData.national_support_status;
    } else if (businessData?.source_type === 'exact' && (businessData as any).national_support_status) { // businessData는 이제 ReferenceData 타입이므로 타입 단언 필요할 수 있음
      // ReferenceData에는 national_support_status가 없음 (인터페이스 확인 필요)
      // ReferenceData 인터페이스에 national_support_status 추가 필요? 
      // -> 확인: mapMeasurementBusinessToRef에서 빠져있음. 추가하는게 좋음.
      nationalSupportStatus = null;
    } else if (previousJournal?.national_support_status) {
      nationalSupportStatus = previousJournal.national_support_status;
    }

    // previousJournal이 없어도 fallbackDefaults가 있으면 데이터를 반환할 수 있도록 함
    // 또는 businessData가 있으면 반환
    const hasData = previousJournal || Object.keys(fallbackDefaults).length > 0 || businessData || (referenceData.source_type !== 'none');

    if (!hasData && !nationalSupportData && !summaryData) {
      return NextResponse.json({
        previousData: null,
        nationalSupportStatus,
        message: "직전 측정일지 데이터가 없습니다.",
        referenceData
      });
    }

    // 디버깅: 직전 측정일지 데이터 확인
    if (previousJournal) {
      console.log('[previous-data API] 직전 측정일지:', {
        id: previousJournal.id,
        year: previousJournal.measurement_year,
        period: previousJournal.measurement_period,
      });
    }

    // [COMPATIBILITY] historyReferenceData를 businessHistoryDefaults 이름으로 매핑 (기본적으로 과거 이력 기준)
    const businessHistoryDefaults: Record<string, any> = {
      manager_name: historyReferenceData.manager_name || null,
      manager_position: historyReferenceData.manager_position || null,
      manager_mobile: historyReferenceData.manager_mobile || null,
      manager_email: historyReferenceData.manager_email || null,
      invoice_email: historyReferenceData.invoice_email || null,
      industrial_accident_number: historyReferenceData.industrial_accident_number || null,
      commencement_number: historyReferenceData.commencement_number || null,
      representative_name: historyReferenceData.representative_name || null,
    };

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

    // 직전 측정일지에서 자동 채울 수 있는 필드만 반환
    // 담당자 정보 우선순위: 계획/마스터(referenceData) > 직전 일지(journal) > 최근 일지(fallback)
    const previousManagerName = historyReferenceData.manager_name || previousJournal?.manager_name || fallbackDefaults.manager_name || null;
    const previousData = hasData ? {
      // 담당자 정보
      manager_name: previousManagerName,
      manager_position: historyReferenceData.manager_position || previousJournal?.manager_position || fallbackDefaults.manager_position || null,
      manager_mobile: normalizePhoneLikeValue(historyReferenceData.manager_mobile || previousJournal?.manager_mobile || fallbackDefaults.manager_mobile, previousManagerName),
      manager_email: historyReferenceData.manager_email || previousJournal?.manager_email || fallbackDefaults.manager_email || null,

      // 총인원: 1순위(과거 마스터/이력), 2순위(직전 측정일지)
      total_employees: historyReferenceData.total_employees ?? previousJournal?.total_employees ?? null,

      // 측정비 정보 (과거 일지 데이터 유지)
      measurement_fee_business: previousJournal?.measurement_fee_business || null,
      measurement_fee_national: previousJournal?.measurement_fee_national || null,

      // 이메일 정보
      invoice_email: historyReferenceData.invoice_email || previousJournal?.invoice_email || fallbackDefaults.invoice_email || null,
      invoice_email_2: previousJournal?.invoice_email_2 || null,

      // 측정자/전송자 (과거 일지 데이터 유지)
      measurer: previousJournal?.measurer || null,
      k2b_sender: previousJournal?.k2b_sender || null,

      // 산재관리번호 (과거 마스터 정보 우선)
      industrial_accident_number: historyReferenceData.industrial_accident_number || previousJournal?.industrial_accident_number || fallbackDefaults.industrial_accident_number || null,

      // 개시번호 (과거 마스터 정보 우선)
      commencement_number: historyReferenceData.commencement_number || previousJournal?.commencement_number || fallbackDefaults.commencement_number || null,

      // 대표자명 (과거 마스터 정보 우선)
      representative_name: historyReferenceData.representative_name || previousJournal?.representative_name || fallbackDefaults.representative_name || null,

      // 전화번호 및 FAX
      phone: historyReferenceData.phone || previousJournal?.phone || fallbackDefaults.phone || null,
      fax: historyReferenceData.fax || previousJournal?.fax || fallbackDefaults.fax || null,

      // 업종분류 (과거 정보 우선)
      business_category: historyReferenceData.business_category || previousJournal?.business_category || null,
    } : null;

    // 디버깅: previousData 확인
    if (previousData) {
      console.log('[previous-data API] previousData 산재관리번호:', previousData.industrial_accident_number);
    }

    // measurement_summary에서 추가 정보 가져오기
    const summaryManagerName = summaryData?.manager_name || null;
    const summaryInfo = summaryData ? {
      manager_name: summaryManagerName,
      manager_mobile: normalizePhoneLikeValue(summaryData.manager_mobile, summaryManagerName),
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
      surveys, // 해당 기간의 모든 예비조사 목록
      referenceData, // 프론트엔드에서 자동 완성에 사용됨
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
