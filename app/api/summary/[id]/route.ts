import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";

/**
 * 측정정보 요약 수정 API
 * 수정 불가 필드(document_number, sequence_number, five_plus_sequence)는 제외하고 업데이트
 * PATCH /api/summary/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 권한 체크
    await checkPermission("journal:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const journalId = parseInt(params.id);
    if (isNaN(journalId)) {
      return NextResponse.json(
        { error: "유효하지 않은 ID입니다." },
        { status: 400 }
      );
    }

    const body = await request.json();

    // 수정 불가 필드 제거
    const {
      document_number,
      sequence_number,
      five_plus_sequence,
      journal_id,
      survey_id,
      id,
      created_at,
      updated_at,
      ...updateData
    } = body;

    const supabase = await createClient();

    // 측정일지 존재 확인
    const { data: existingJournal, error: checkError } = await supabase
      .from("measurement_journal")
      .select("id, completion_status")
      .eq("id", journalId)
      .maybeSingle();

    if (checkError) {
      console.error("측정일지 조회 오류:", checkError);
      return NextResponse.json(
        { error: "측정일지를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (!existingJournal) {
      return NextResponse.json(
        { error: "측정일지를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 완료된 측정일지는 수정 불가 (애플리케이션 레벨 제약)
    if (existingJournal.completion_status === "완료") {
      return NextResponse.json(
        { error: "완료된 측정일지는 수정할 수 없습니다." },
        { status: 400 }
      );
    }

    // 측정일지 업데이트
    const { data: updatedJournal, error: updateError } = await supabase
      .from("measurement_journal")
      .update({
        ...updateData,
        updated_by: user.email || user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", journalId)
      .select()
      .single();

    if (updateError) {
      console.error("측정일지 업데이트 오류:", updateError);
      return NextResponse.json(
        { error: "측정일지를 업데이트하는 중 오류가 발생했습니다.", details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updatedJournal,
    });
  } catch (error: any) {
    console.error("측정정보 요약 수정 오류:", error);
    return NextResponse.json(
      { error: error.message || "측정정보를 수정하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
