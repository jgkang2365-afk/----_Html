import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { reassignSequenceNumbers } from "@/lib/utils/survey-sequence";
import { getKSTISOString } from "@/lib/utils/date-utils";

/**
 * 예비조사 수정/삭제 API
 * PUT: 예비조사 수정
 * DELETE: 예비조사 삭제
 * 
 * 중요: 예비조사 수정은 preliminary_survey 테이블만 업데이트하며,
 * measurement_journal 테이블에는 영향을 주지 않습니다.
 * 두 테이블은 독립적이며, 서로 직접적인 관계가 없습니다.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 권한 체크
    await checkPermission("survey:write");

    const { id } = await params;
    const body = await request.json();
    const {
      year,
      period,
      measurement_date,
      end_date,
      measurement_weekdays,
      code,
      business_name,
      measurer,
      survey_code,
      address,
      preliminary_surveyor,
      actual_measurer,
      report_writer,
    } = body;

    // 필수 필드 검증
    if (!measurement_date || !business_name) {
      return NextResponse.json(
        { error: "측정일과 사업장명은 필수 항목입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 1. 해당 일자 등록 업체 수 제한 (6개 미만이어야 함 -> 6개 이상이면 등록 불가)
    // 수정 시에는 자기 자신(id)은 카운트에서 제외해야 함 (날짜가 바뀌지 않는 경우 등)
    const { count: dateCount, error: dateCountError } = await supabase
      .from("preliminary_survey")
      .select("id", { count: "exact", head: true })
      .eq("measurement_date", measurement_date)
      .neq("id", parseInt(id));

    if (dateCountError) {
      console.error("일자별 등록 건수 조회 오류:", dateCountError);
    } else if ((dateCount || 0) > 6) {
      return NextResponse.json(
        { error: `해당 일자(${measurement_date})에는 이미 6개를 초과하는 업체가 등록되어 있어 변경할 수 없습니다.` },
        { status: 400 }
      );
    }

    // 2. 동일 일자 측정자 중복 체크
    if (measurer) {
      const { data: sameDateSurveys, error: measurerCheckError } = await supabase
        .from("preliminary_survey")
        .select("measurer")
        .eq("measurement_date", measurement_date)
        .neq("id", parseInt(id))
        .not("measurer", "is", null);

      if (measurerCheckError) {
        console.error("측정자 중복 체크 오류:", measurerCheckError);
      } else if (sameDateSurveys && sameDateSurveys.length > 0) {
        const newMeasurers = measurer.split(",").map((m: string) => m.trim());

        for (const survey of sameDateSurveys) {
          if (!survey.measurer) continue;
          const existingMeasurers = survey.measurer.split(",").map((m: string) => m.trim());

          // 교집합 확인
          const duplicates = newMeasurers.filter((nm: string) => existingMeasurers.includes(nm));
          if (duplicates.length > 0) {
            return NextResponse.json(
              { error: `측정자 [${duplicates.join(", ")}]님은 해당 일자(${measurement_date})에 이미 다른 일정(업체)이 배정되어 있습니다.` },
              { status: 400 }
            );
          }
        }
      }
    }

    // 3. 동일 일자 공시료 번호 중복 체크
    if (survey_code) {
      const { data: duplicateSurveyCode, error: surveyCodeError } = await supabase
        .from("preliminary_survey")
        .select("id, business_name")
        .eq("measurement_date", measurement_date)
        .eq("survey_code", survey_code)
        .neq("id", parseInt(id))
        .maybeSingle();

      if (surveyCodeError) {
        console.error("공시료 번호 중복 체크 오류:", surveyCodeError);
      } else if (duplicateSurveyCode) {
        return NextResponse.json(
          { error: `공시료 번호 [${survey_code}]는 해당 일자(${measurement_date})에 이미 다른 업체(${duplicateSurveyCode.business_name})에서 사용 중입니다.` },
          { status: 400 }
        );
      }
    }

    // 예비조사 수정 (preliminary_survey 테이블만 업데이트, measurement_journal에는 영향 없음)
    const { data: survey, error } = await supabase
      .from("preliminary_survey")
      .update({
        year: year ? parseInt(year) : undefined,
        period: period || undefined,
        measurement_date,
        end_date: end_date || measurement_date,
        measurement_weekdays: measurement_weekdays || null,
        code: code || null,
        business_name,
        measurer: measurer || null,
        survey_code: survey_code || null,
        address: address || null,
        preliminary_surveyor: preliminary_surveyor || null,
        actual_measurer: actual_measurer || null,
        report_writer: report_writer || null,
        updated_at: getKSTISOString(),
      })
      .eq("id", parseInt(id))
      .select()
      .single();

    if (error) {
      console.error("예비조사 수정 오류:", error);
      return NextResponse.json(
        { error: "예비조사 수정 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }
    // [The Joo Rule] Full Re-calculation: 모든 일정을 다시 계산하여 사업장 목록 및 일지 동기화
    if (code && year && period) {
      try {
        const { syncBusinessSchedule } = await import("@/lib/utils/survey-sync");
        await syncBusinessSchedule(supabase, code, year, period);
      } catch (syncError) {
        console.error("[Full Re-Sync] Failed in PUT:", syncError);
      }
    }

    // [The Joo Rule] Business Name Sync
    try {
      await supabase
        .from("measurement_target_business")
        .update({
          business_name: business_name
        })
        .eq("code", code);
    } catch (nameSyncError) {
      console.error("Business name sync error:", nameSyncError);
    }

    // === [Calendar Sync] 예비조사 수정 시 캘린더 이벤트 자동 업데이트 ===
    try {
      const { syncBusinessToCalendar } = await import("@/lib/google/sync-service");

      // 해당 코드의 measurement_target_business 조회
      const { data: targetBiz } = await supabase
        .from("measurement_target_business")
        .select("google_event_id, measurer_id, measurement_date, address, manager_mobile, manager_name, phone, notes, is_registered")
        .eq("code", code)
        .order("year", { ascending: false })
        .limit(1)
        .maybeSingle();

      // [수정] 2026년 2월 23일부터 정식 연동 (1/12은 테스트 완료 건으로 예외 허용)
      const isTargetDate = targetBiz?.measurement_date === "2026-01-12" ||
        (targetBiz?.measurement_date ? new Date(targetBiz.measurement_date) >= new Date("2026-02-23") : false);

      const isConfirmedBiz = targetBiz && (targetBiz.is_registered === "확정" || targetBiz.is_registered === "실시");

      // 로직 완화: google_event_id가 없더라도 확정 상태라면 동기화를 시도하여 신규 생성
      if (isConfirmedBiz && targetBiz.measurement_date && isTargetDate && year && period) {
        await syncBusinessToCalendar(supabase, code, year, period);
        console.log(`[Survey Sync] Calendar sync triggered for ${code} on PATCH`);
      }
    } catch (calErr) {
      console.error("[Survey->Calendar] Calendar sync error:", calErr);
      // 캘린더 오류가 발생해도 예비조사 수정은 성공으로 처리
    }

    // 순번 재정렬 (측정일 기준)
    await reassignSequenceNumbers(supabase);

    // 재정렬된 최신 정보 조회 (순번이 변경되었을 수 있으므로)
    const { data: updatedSurvey } = await supabase
      .from("preliminary_survey")
      .select("*")
      .eq("id", survey.id)
      .single();

    return NextResponse.json({ survey: updatedSurvey || survey });
  } catch (error) {
    console.error("예비조사 수정 API 오류:", error);

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
        error: "예비조사 수정 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 권한 체크
    await checkPermission("survey:write");

    const { id } = await params;

    const supabase = await createClient();

    // 삭제할 예비조사의 정보 조회 (동기화용)
    const { data: surveyToDelete, error: selectError } = await supabase
      .from("preliminary_survey")
      .select("sequence_number, code, year, period")
      .eq("id", parseInt(id))
      .single();

    if (selectError || !surveyToDelete) {
      return NextResponse.json(
        { error: "삭제할 예비조사를 찾을 수 없습니다.", details: selectError?.message },
        { status: 404 }
      );
    }

    const deletedSequenceNumber = surveyToDelete.sequence_number;
    const deletedCode = surveyToDelete.code;

    // 예비조사 삭제
    const { error } = await supabase
      .from("preliminary_survey")
      .delete()
      .eq("id", parseInt(id));

    if (error) {
      console.error("예비조사 삭제 오류:", error);
      return NextResponse.json(
        { error: "예비조사 삭제 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    // 삭제된 순번보다 큰 순번들을 모두 -1 (재정렬) -> 이제 전체 재정렬 로직으로 대체
    // 순번 재정렬 (측정일 기준)
    await reassignSequenceNumbers(supabase);

    // [The Joo Rule] Full Re-calculation: 모든 일정을 다시 계산하여 사업장 목록 및 일지 동기화
    if (deletedCode && surveyToDelete.year && surveyToDelete.period) {
      try {
        const { syncBusinessSchedule } = await import("@/lib/utils/survey-sync");
        await syncBusinessSchedule(supabase, deletedCode, surveyToDelete.year, surveyToDelete.period);
      } catch (syncError) {
        console.error("[Full Re-Sync] Failed in DELETE:", syncError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("예비조사 삭제 API 오류:", error);

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
        error: "예비조사 삭제 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
