import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/get-user";
import { requireAdmin } from "@/lib/auth/require-permission";

/**
 * 번호 변경 요청 승인/거부 API
 * POST /api/journal/number-change-request/[id]/approve
 * 관리자만 승인/거부할 수 있습니다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // 관리자 권한 확인
    await requireAdmin();

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const requestId = parseInt(params.id, 10);
    if (isNaN(requestId)) {
      return NextResponse.json(
        { error: "유효하지 않은 요청 ID입니다." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { action, rejection_reason } = body; // action: "approve" | "reject"

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "유효하지 않은 액션입니다. 'approve' 또는 'reject'를 사용하세요." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 번호 변경 요청 조회
    const { data: changeRequest, error: fetchError } = await supabase
      .from("journal_number_change_request")
      .select("*")
      .eq("id", requestId)
      .single();

    if (fetchError || !changeRequest) {
      return NextResponse.json(
        { error: "번호 변경 요청을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (changeRequest.status !== "대기") {
      return NextResponse.json(
        { error: "이미 처리된 요청입니다." },
        { status: 400 }
      );
    }

    // 측정일지 조회
    const { data: journal, error: journalError } = await supabase
      .from("measurement_journal")
      .select("id, completion_status")
      .eq("id", changeRequest.journal_id)
      .single();

    if (journalError || !journal) {
      return NextResponse.json(
        { error: "측정일지를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 완료된 측정일지는 수정 불가
    if (journal.completion_status === "완료") {
      return NextResponse.json(
        { error: "완료된 측정일지는 수정할 수 없습니다." },
        { status: 403 }
      );
    }

    if (action === "approve") {
      // 승인: 측정일지 번호 업데이트
      const updateData: any = {};
      
      if (changeRequest.new_document_number !== changeRequest.old_document_number) {
        updateData.document_number = changeRequest.new_document_number;
      }
      if (changeRequest.new_sequence_number !== changeRequest.old_sequence_number) {
        updateData.sequence_number = changeRequest.new_sequence_number;
      }
      if (changeRequest.new_five_plus_sequence !== changeRequest.old_five_plus_sequence) {
        updateData.five_plus_sequence = changeRequest.new_five_plus_sequence;
      }

      // 중복 확인 (공문연번은 UNIQUE 제약조건)
      if (updateData.document_number) {
        const { data: duplicate, error: duplicateError } = await supabase
          .from("measurement_journal")
          .select("id")
          .eq("document_number", updateData.document_number)
          .neq("id", journal.id)
          .maybeSingle();

        if (duplicateError && duplicateError.code !== "PGRST116") {
          console.error("중복 확인 오류:", duplicateError);
          return NextResponse.json(
            { error: "중복 확인 중 오류가 발생했습니다." },
            { status: 500 }
          );
        }

        if (duplicate) {
          return NextResponse.json(
            { error: `공문연번 '${updateData.document_number}'는 이미 사용 중입니다.` },
            { status: 409 }
          );
        }
      }

      // 측정일지 업데이트
      const { error: updateError } = await supabase
        .from("measurement_journal")
        .update({
          ...updateData,
          updated_at: new Date().toISOString(),
          updated_by: user.name,
        })
        .eq("id", journal.id);

      if (updateError) {
        console.error("측정일지 업데이트 오류:", updateError);
        return NextResponse.json(
          { error: "측정일지 업데이트 중 오류가 발생했습니다.", details: updateError.message },
          { status: 500 }
        );
      }

      // 요청 상태 업데이트 (승인)
      const { error: requestUpdateError } = await supabase
        .from("journal_number_change_request")
        .update({
          status: "승인",
          approved_by: user.name,
          approved_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (requestUpdateError) {
        console.error("요청 상태 업데이트 오류:", requestUpdateError);
        // 측정일지는 이미 업데이트되었으므로 경고만 로그
      }

      return NextResponse.json({
        success: true,
        message: "번호 변경이 승인되어 적용되었습니다.",
      });
    } else {
      // 거부: 요청 상태만 업데이트
      const { error: requestUpdateError } = await supabase
        .from("journal_number_change_request")
        .update({
          status: "거부",
          approved_by: user.name,
          approved_at: new Date().toISOString(),
          rejection_reason: rejection_reason || null,
        })
        .eq("id", requestId);

      if (requestUpdateError) {
        console.error("요청 상태 업데이트 오류:", requestUpdateError);
        return NextResponse.json(
          { error: "요청 거부 처리 중 오류가 발생했습니다.", details: requestUpdateError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "번호 변경 요청이 거부되었습니다.",
      });
    }
  } catch (error) {
    console.error("번호 변경 요청 승인 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "관리자 권한이 필요합니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "번호 변경 요청 처리 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
