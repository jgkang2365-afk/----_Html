import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

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

    // 예비조사 수정 (preliminary_survey 테이블만 업데이트, measurement_journal에는 영향 없음)
    const { data: survey, error } = await supabase
      .from("preliminary_survey")
      .update({
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
        updated_at: new Date().toISOString(),
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

    return NextResponse.json({ survey });
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

    // 삭제할 예비조사의 순번 조회
    const { data: surveyToDelete, error: selectError } = await supabase
      .from("preliminary_survey")
      .select("sequence_number")
      .eq("id", parseInt(id))
      .single();

    if (selectError || !surveyToDelete) {
      return NextResponse.json(
        { error: "삭제할 예비조사를 찾을 수 없습니다.", details: selectError?.message },
        { status: 404 }
      );
    }

    const deletedSequenceNumber = surveyToDelete.sequence_number;

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

    // 삭제된 순번보다 큰 순번들을 모두 -1 (재정렬)
    if (deletedSequenceNumber !== null) {
      // 삭제된 순번보다 큰 모든 항목 조회
      const { data: surveysToUpdate, error: fetchError } = await supabase
        .from("preliminary_survey")
        .select("id, sequence_number")
        .gt("sequence_number", deletedSequenceNumber)
        .order("sequence_number", { ascending: true });

      if (!fetchError && surveysToUpdate) {
        // 각 항목의 순번을 -1 업데이트
        for (const survey of surveysToUpdate) {
          const { error: updateError } = await supabase
            .from("preliminary_survey")
            .update({ sequence_number: survey.sequence_number - 1 })
            .eq("id", survey.id);

          if (updateError) {
            console.error(`순번 재정렬 오류 (id: ${survey.id}):`, updateError);
          }
        }
      } else if (fetchError) {
        console.error("순번 재정렬 대상 조회 오류:", fetchError);
        // 삭제는 성공했으므로 경고만 로그에 남기고 성공 응답 반환
        console.warn("순번 재정렬 대상 조회 실패:", fetchError.message);
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
