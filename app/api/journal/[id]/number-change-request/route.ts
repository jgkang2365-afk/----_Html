import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";

/**
 * 번호 변경 요청 API
 * POST /api/journal/[id]/number-change-request
 * 일반 사용자가 공문연번, 연번, 5인 이상 연번 변경을 요청합니다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await checkPermission("journal:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    // 관리자는 직접 수정 가능하므로 요청 불필요
    if (user.role === "관리자") {
      return NextResponse.json(
        { error: "관리자는 직접 수정할 수 있습니다." },
        { status: 400 }
      );
    }

    const journalId = parseInt(params.id, 10);
    if (isNaN(journalId)) {
      return NextResponse.json(
        { error: "유효하지 않은 측정일지 ID입니다." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      document_number,
      sequence_number,
      five_plus_sequence,
    } = body;

    const supabase = await createClient();

    // 기존 측정일지 조회
    const { data: existingJournal, error: fetchError } = await supabase
      .from("measurement_journal")
      .select("id, document_number, sequence_number, five_plus_sequence, completion_status")
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

    // 변경 사항 확인
    const hasChanges =
      (document_number !== undefined && document_number !== existingJournal.document_number) ||
      (sequence_number !== undefined && sequence_number !== existingJournal.sequence_number) ||
      (five_plus_sequence !== undefined && five_plus_sequence !== existingJournal.five_plus_sequence);

    if (!hasChanges) {
      return NextResponse.json(
        { error: "변경할 번호가 없습니다." },
        { status: 400 }
      );
    }

    // 기존 대기 중인 요청 확인
    const { data: existingRequest, error: existingRequestError } = await supabase
      .from("journal_number_change_request")
      .select("id")
      .eq("journal_id", journalId)
      .eq("status", "대기")
      .maybeSingle();

    if (existingRequestError && existingRequestError.code !== "PGRST116") {
      console.error("기존 요청 조회 오류:", existingRequestError);
      return NextResponse.json(
        { error: "기존 요청 확인 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (existingRequest) {
      return NextResponse.json(
        { error: "이미 대기 중인 번호 변경 요청이 있습니다." },
        { status: 409 }
      );
    }

    // 번호 변경 요청 생성
    const { data: newRequest, error: insertError } = await supabase
      .from("journal_number_change_request")
      .insert({
        journal_id: journalId,
        requested_by: user.name,
        old_document_number: existingJournal.document_number,
        new_document_number: document_number !== undefined ? document_number : existingJournal.document_number,
        old_sequence_number: existingJournal.sequence_number,
        new_sequence_number: sequence_number !== undefined ? sequence_number : existingJournal.sequence_number,
        old_five_plus_sequence: existingJournal.five_plus_sequence,
        new_five_plus_sequence: five_plus_sequence !== undefined ? five_plus_sequence : existingJournal.five_plus_sequence,
        status: "대기",
      })
      .select()
      .single();

    if (insertError) {
      console.error("번호 변경 요청 생성 오류:", insertError);
      return NextResponse.json(
        { error: "번호 변경 요청 생성 중 오류가 발생했습니다.", details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id: newRequest.id,
      message: "번호 변경 요청이 생성되었습니다. 관리자 승인을 기다려주세요.",
    });
  } catch (error) {
    console.error("번호 변경 요청 API 오류:", error);

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
        error: "번호 변경 요청 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * 번호 변경 요청 조회 API
 * GET /api/journal/[id]/number-change-request
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await checkPermission("journal:read");

    const journalId = parseInt(params.id, 10);
    if (isNaN(journalId)) {
      return NextResponse.json(
        { error: "유효하지 않은 측정일지 ID입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 대기 중인 요청 조회
    const { data: pendingRequest, error: fetchError } = await supabase
      .from("journal_number_change_request")
      .select("*")
      .eq("journal_id", journalId)
      .eq("status", "대기")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("번호 변경 요청 조회 오류:", fetchError);
      return NextResponse.json(
        { error: "번호 변경 요청 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      request: pendingRequest || null,
    });
  } catch (error) {
    console.error("번호 변경 요청 조회 API 오류:", error);

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
        error: "번호 변경 요청 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
