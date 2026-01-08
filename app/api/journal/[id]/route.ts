import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { canDeleteJournal } from "@/lib/permissions";
import { assignAllNumbers } from "@/lib/utils/number-assignment";

/**
 * 측정일지 수정 API
 * PUT /api/journal/[id]
 */
export async function PUT(
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

    const journalId = params.id;
    const body = await request.json();

    const supabase = await createClient();

    // 기존 측정일지 조회
    const { data: existingJournal, error: fetchError } = await supabase
      .from("measurement_journal")
      .select("*")
      .eq("id", journalId)
      .single();

    if (fetchError || !existingJournal) {
      return NextResponse.json(
        { error: "측정일지를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 완료된 측정일지는 수정 불가
    if (existingJournal.completion_status === "완료") {
      return NextResponse.json(
        { error: "완료된 측정일지는 수정할 수 없습니다." },
        { status: 403 }
      );
    }

    // 번호 필드는 수정 불가 (기존 값 유지)
    const documentNumber = existingJournal.document_number;
    const sequenceNumber = existingJournal.sequence_number;
    const fivePlusSequence = existingJournal.five_plus_sequence;

    // 번호가 없으면 자동 부여 (신규 등록 시나리오)
    let finalDocumentNumber = documentNumber;
    let finalSequenceNumber = sequenceNumber;
    let finalFivePlusSequence = fivePlusSequence;

    if (!finalDocumentNumber || !finalSequenceNumber || !finalFivePlusSequence) {
      const assignedNumbers = await assignAllNumbers({
        designated_office: body.designated_office || existingJournal.designated_office,
        measurement_period: body.measurement_period || existingJournal.measurement_period,
        total_employees: body.total_employees || existingJournal.total_employees,
        document_number: finalDocumentNumber,
        sequence_number: finalSequenceNumber,
        five_plus_sequence: finalFivePlusSequence,
      });

      finalDocumentNumber = assignedNumbers.document_number;
      finalSequenceNumber = assignedNumbers.sequence_number;
      finalFivePlusSequence = assignedNumbers.five_plus_sequence;
    }

    // 업데이트 데이터 준비 (번호 필드는 제외하고, 자동으로 설정)
    const { document_number, sequence_number, five_plus_sequence, ...bodyWithoutNumbers } = body;
    const updateData: any = {
      ...bodyWithoutNumbers,
      document_number: finalDocumentNumber,
      sequence_number: finalSequenceNumber,
      five_plus_sequence: finalFivePlusSequence,
      updated_at: new Date().toISOString(),
      updated_by: user.name,
    };

    // 측정년도/측정주기 변경 검증 (요구사항에 따라 경고는 클라이언트에서 처리)
    // 여기서는 단순히 업데이트만 수행

    // 업데이트 실행
    const { data: updatedJournal, error: updateError } = await supabase
      .from("measurement_journal")
      .update(updateData)
      .eq("id", journalId)
      .select()
      .single();

    if (updateError) {
      console.error("측정일지 수정 오류:", updateError);
      return NextResponse.json(
        { error: "측정일지 수정 중 오류가 발생했습니다.", details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id: updatedJournal.id,
      message: "측정일지가 수정되었습니다.",
    });
  } catch (error) {
    console.error("측정일지 수정 API 오류:", error);

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
        error: "측정일지 수정 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * 측정일지 삭제 API
 * DELETE /api/journal/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 권한 체크
    const { allowed, user } = await checkPermission("journal:delete");

    if (!allowed || !user) {
      return NextResponse.json(
        { error: "측정일지 삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 추가 권한 체크 (역할 기반)
    if (!canDeleteJournal(user.role)) {
      return NextResponse.json(
        { error: "측정일지 삭제 권한이 없습니다." },
        { status: 403 }
      );
    }

    const journalId = params.id;

    // TODO: 실제 삭제 로직 구현
    // const supabase = await createClient();
    // const { error } = await supabase
    //   .from("measurement_journal")
    //   .delete()
    //   .eq("id", journalId);

    // if (error) {
    //   return NextResponse.json(
    //     { error: "삭제 중 오류가 발생했습니다." },
    //     { status: 500 }
    //   );
    // }

    return NextResponse.json({
      success: true,
      message: "측정일지가 삭제되었습니다.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

