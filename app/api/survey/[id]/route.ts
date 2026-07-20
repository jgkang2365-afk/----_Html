import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { reassignSequenceNumbers } from "@/lib/utils/survey-sequence";
import { getKSTISOString } from "@/lib/utils/date-utils";
import {
  MEASURER_OVERLAP_CONFIRMATION_CODE,
  MEASURER_OVERLAP_LIMIT_CODE,
  rebalanceSurveyCodesForDate,
  resolveSurveyAssignment,
  getActiveMeasurerCount,
  calculateActualSlots,
} from "@/lib/utils/survey-assignment";
import { getUser } from "@/lib/auth/get-user";

/**
 * 예비조사 수정/삭제 API
 * PUT: 예비조사 수정
 * DELETE: 예비조사 삭제
 *
 * 중요: 예비조사 수정은 preliminary_survey 테이블만 업데이트하며,
 * measurement_journal 테이블에는 영향을 주지 않습니다.
 * 두 테이블은 독립적이며, 서로 직접적인 관계가 없습니다.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      address,
      preliminary_surveyor,
      actual_measurer,
      report_writer,
      assignee_manual_override,
      confirm_measurer_overlap,
      confirm_limit_over,
    } = body;

    // 필수 필드 검증
    if (!measurement_date || !business_name || !measurer) {
      return NextResponse.json(
        { error: "측정일, 사업장명, 측정자는 필수 항목입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const surveyId = parseInt(id);
    const { data: existingSurvey, error: existingSurveyError } = await supabase
      .from("preliminary_survey")
      .select("measurement_date, measurer, survey_code")
      .eq("id", surveyId)
      .single();

    if (existingSurveyError || !existingSurvey) {
      return NextResponse.json({ error: "수정할 예비조사를 찾을 수 없습니다." }, { status: 404 });
    }

    // 1. 자기 자신을 제외하고 해당 일자 동적 등록 제한 체크 (활성 측정자 수 기반)
    const limitCount = await getActiveMeasurerCount(supabase);
    const { data: dateSurveys, error: dateSurveysError } = await supabase
      .from("preliminary_survey")
      .select("survey_code")
      .eq("measurement_date", measurement_date)
      .neq("id", surveyId);

    if (dateSurveysError) {
      console.error("일자별 등록 건수 조회 오류:", dateSurveysError);
      return NextResponse.json(
        { error: "일자별 등록 건수를 확인하지 못해 저장을 중단했습니다." },
        { status: 500 }
      );
    }

    const actualSlots = calculateActualSlots(dateSurveys || []);

    if (actualSlots >= limitCount) {
      // 로그인된 사용자 정보 및 권한 확인
      const currentUser = await getUser();
      const isAuthorized =
        currentUser?.role === "관리자" || currentUser?.is_journal_manager === true;

      // 권한이 있고, 프론트에서 초과 확인(confirm_limit_over)을 보낸 경우에만 저장을 허용합니다.
      if (isAuthorized && confirm_limit_over === true) {
        // 예외 허용 처리하여 통과합니다.
      } else {
        return NextResponse.json(
          {
            error:
              "해당 일자(" +
              measurement_date +
              `)에는 이미 ${limitCount}개 업체가 등록되어 있어 변경할 수 없습니다.`,
            code: "LIMIT_EXCEEDED",
            limitCount,
            actualSlots,
            isAuthorized,
          },
          { status: 400 }
        );
      }
    }

    // 2. 첫 번째 측정자를 기준으로 공시료 코드를 자동 결정
    let assignment;
    try {
      assignment = await resolveSurveyAssignment({
        supabase,
        measurementDate: measurement_date,
        measurer,
        surveyId,
        currentSurveyCode: existingSurvey.survey_code,
        confirmOverlap: confirm_measurer_overlap === true,
      });
    } catch (assignmentError) {
      const message =
        assignmentError instanceof Error
          ? assignmentError.message
          : "측정자 배정 확인 중 오류가 발생했습니다.";
      const code = assignmentError instanceof Error ? assignmentError.name : undefined;

      return NextResponse.json(
        { error: message, code },
        { status: code === MEASURER_OVERLAP_LIMIT_CODE ? 409 : 400 }
      );
    }

    if (assignment.requiresConfirmation) {
      return NextResponse.json(
        {
          code: MEASURER_OVERLAP_CONFIRMATION_CODE,
          error: assignment.primaryMeasurer + "님이 같은 날짜에 이미 다른 업체를 측정합니다.",
          primaryMeasurer: assignment.primaryMeasurer,
          suggestedSurveyCode: assignment.surveyCode,
          conflicts: assignment.conflicts,
        },
        { status: 409 }
      );
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
        survey_code: assignment.surveyCode,
        address: address || null,
        preliminary_surveyor: preliminary_surveyor || null,
        actual_measurer: actual_measurer || null,
        report_writer: report_writer || null,
        assignee_manual_override: assignee_manual_override === true,
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

    if (
      existingSurvey.measurement_date !== measurement_date ||
      existingSurvey.measurer !== measurer
    ) {
      await rebalanceSurveyCodesForDate(
        supabase,
        existingSurvey.measurement_date,
        existingSurvey.measurer || ""
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
          business_name: business_name,
        })
        .eq("code", code);
    } catch (nameSyncError) {
      console.error("Business name sync error:", nameSyncError);
    }

    // === [Calendar Sync] 예비조사 수정 시 캘린더 이벤트 자동 업데이트 ===
    if (code && year && period) {
      try {
        const { syncBusinessToCalendar } = await import("@/lib/google/sync-service");

        // 최신 상태의 사업장 마스터 정보 조회
        const { data: targetBiz } = await supabase
          .from("measurement_target_business")
          .select("is_registered, measurement_date")
          .eq("code", code)
          .maybeSingle();

        const isConfirmedBiz =
          targetBiz && (targetBiz.is_registered === "확정" || targetBiz.is_registered === "실시");

        // 2026-02-23 이후 데이터 또는 정식 연동 대상에 대해 동기화 실행
        const isTargetDate =
          targetBiz?.measurement_date === "2026-01-12" ||
          (targetBiz?.measurement_date
            ? new Date(targetBiz.measurement_date) >= new Date("2026-02-23")
            : false);

        if (isConfirmedBiz && isTargetDate) {
          await syncBusinessToCalendar(supabase, code, year, period);
          console.log(`[Survey Sync] Calendar sync triggered for ${code} on PUT`);
        }
      } catch (calErr) {
        console.error("[Survey->Calendar] Calendar sync error:", calErr);
      }
    }

    // 순번 재정렬 (측정일 기준)
    await reassignSequenceNumbers(supabase);

    // 재정렬된 최신 정보 조회 (순번이 변경되었을 수 있으므로)
    const { data: updatedSurvey } = await supabase
      .from("preliminary_survey")
      .select("*")
      .eq("id", survey.id)
      .single();

    return NextResponse.json({
      survey: updatedSurvey || survey,
      assignedSurveyCode: assignment.surveyCode,
      overlapApplied: assignment.assignmentNumber === 2,
    });
  } catch (error) {
    console.error("예비조사 수정 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
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
      .select("sequence_number, code, year, period, google_event_id, measurement_date, measurer")
      .eq("id", parseInt(id))
      .single();

    if (selectError || !surveyToDelete) {
      return NextResponse.json(
        { error: "삭제할 예비조사를 찾을 수 없습니다.", details: selectError?.message },
        { status: 404 }
      );
    }

    // [Calendar Sync] 연동된 구글 캘린더 이벤트 삭제
    if (surveyToDelete.google_event_id) {
      try {
        const { deleteSurveyEvent } = await import("@/lib/google/calendar");
        await deleteSurveyEvent(surveyToDelete.google_event_id);
        console.log(
          `[Survey Sync] Deleted associated calendar event: ${surveyToDelete.google_event_id}`
        );
      } catch (calErr) {
        console.error("[Survey Sync] Failed to delete calendar event:", calErr);
      }
    }

    const deletedSequenceNumber = surveyToDelete.sequence_number;
    const deletedCode = surveyToDelete.code;

    // 예비조사 삭제
    const { error } = await supabase.from("preliminary_survey").delete().eq("id", parseInt(id));

    if (error) {
      console.error("예비조사 삭제 오류:", error);
      return NextResponse.json(
        { error: "예비조사 삭제 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    await rebalanceSurveyCodesForDate(
      supabase,
      surveyToDelete.measurement_date,
      surveyToDelete.measurer || ""
    );

    // 삭제된 순번보다 큰 순번들을 모두 -1 (재정렬) -> 이제 전체 재정렬 로직으로 대체
    // 순번 재정렬 (측정일 기준)
    await reassignSequenceNumbers(supabase);

    // [The Joo Rule] Full Re-calculation: 모든 일정을 다시 계산하여 사업장 목록 및 일지 동기화
    if (deletedCode && surveyToDelete.year && surveyToDelete.period) {
      try {
        const { syncBusinessSchedule } = await import("@/lib/utils/survey-sync");
        await syncBusinessSchedule(
          supabase,
          deletedCode,
          surveyToDelete.year,
          surveyToDelete.period
        );

        // [Calendar Sync] 삭제 후 전체 정합성 복구 (Successful Null)
        const { syncBusinessToCalendar } = await import("@/lib/google/sync-service");
        await syncBusinessToCalendar(
          supabase,
          deletedCode,
          surveyToDelete.year,
          surveyToDelete.period
        );
        console.log(
          `[Survey Sync] Final calendar reconciliation triggered for ${deletedCode} after deletion`
        );
      } catch (syncError) {
        console.error("[Full Re-Sync] Failed in DELETE:", syncError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("예비조사 삭제 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
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
