import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { canDeleteJournal } from "@/lib/permissions";
import { assignAllNumbers } from "@/lib/utils/number-assignment";
import { toShortName } from "@/lib/constants/designated-offices";
import { fullNameToShortName } from "@/lib/utils/jurisdiction-matcher";

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
        measurement_year: body.measurement_year || existingJournal.measurement_year,
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

    // designated_office 정규화 (약칭으로 저장)
    const normalizedDesignatedOffice = body.designated_office 
      ? toShortName(body.designated_office) || body.designated_office
      : existingJournal.designated_office;

    // office_jurisdiction 정규화 (약칭으로 저장)
    const normalizedOfficeJurisdiction = body.office_jurisdiction
      ? (fullNameToShortName(body.office_jurisdiction) || body.office_jurisdiction)
      : existingJournal.office_jurisdiction;

    // 업데이트 데이터 준비 (번호 필드는 제외하고, 자동으로 설정)
    const { document_number, sequence_number, five_plus_sequence, designated_office, office_jurisdiction, ...bodyWithoutNumbers } = body;
    const updateData: any = {
      ...bodyWithoutNumbers,
      designated_office: normalizedDesignatedOffice, // 약칭으로 저장
      office_jurisdiction: normalizedOfficeJurisdiction, // 약칭으로 저장
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

    // 측정 대상 사업장 계획 업데이트 (진행률 파악)
    // 해당 code, year, period의 계획이 있으면 등록 정보 업데이트
    const code = updatedJournal.code;
    const measurementYear = updatedJournal.measurement_year;
    const measurementPeriod = updatedJournal.measurement_period;

    const { data: existingPlan, error: planCheckError } = await supabase
      .from("measurement_target_business")
      .select("id")
      .eq("code", code)
      .eq("year", measurementYear)
      .eq("period", measurementPeriod)
      .maybeSingle();

    if (!planCheckError && existingPlan) {
      // 계획이 있으면 등록 정보 업데이트
      const { error: planUpdateError } = await supabase
        .from("measurement_target_business")
        .update({
          journal_id: updatedJournal.id,
          is_registered: true,
          registered_at: new Date().toISOString(),
          measurement_start_date: updatedJournal.measurement_start_date,
          measurement_end_date: updatedJournal.measurement_end_date,
          completion_status: updatedJournal.completion_status,
          measurer: updatedJournal.measurer,
          business_name: updatedJournal.business_name,
          business_number: updatedJournal.business_number,
          total_employees: updatedJournal.total_employees,
          address: updatedJournal.address,
          office_jurisdiction: updatedJournal.office_jurisdiction,
          national_support_status: updatedJournal.national_support_status || null,
          manager_name: updatedJournal.manager_name,
          manager_mobile: updatedJournal.manager_mobile,
          manager_phone: updatedJournal.phone,
        })
        .eq("id", existingPlan.id);

      if (planUpdateError) {
        console.error("측정 대상 사업장 계획 업데이트 오류:", planUpdateError);
        // 계획 업데이트 실패해도 측정일지 수정은 성공으로 처리
      }
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
    // 사용자 정보 먼저 가져오기
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다.", success: false },
        { status: 401 }
      );
    }

    // 권한 체크 (역할 기반)
    if (!canDeleteJournal(user.role)) {
      console.log(`사용자 ${user.name}(${user.role})의 삭제 권한 없음`);
      return NextResponse.json(
        { error: "측정일지 삭제 권한이 없습니다. 관리자만 삭제할 수 있습니다.", success: false },
        { status: 403 }
      );
    }

    const journalId = params.id;

    if (!journalId) {
      return NextResponse.json(
        { error: "측정일지 ID가 필요합니다.", success: false },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 실제 삭제 로직 구현 (삭제된 행을 반환받아 확인)
    const { data: deletedData, error } = await supabase
      .from("measurement_journal")
      .delete()
      .eq("id", journalId)
      .select();

    if (error) {
      console.error("측정일지 삭제 오류:", error);
      return NextResponse.json(
        { 
          error: "삭제 중 오류가 발생했습니다.", 
          details: error.message,
          success: false 
        },
        { status: 500 }
      );
    }

    // 삭제된 항목이 없는 경우
    if (!deletedData || deletedData.length === 0) {
      return NextResponse.json(
        { error: "측정일지를 찾을 수 없습니다.", success: false },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "측정일지가 삭제되었습니다.",
    });
  } catch (error: any) {
    console.error("측정일지 삭제 API 오류:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // 에러 타입에 따라 적절한 응답 반환
    if (errorMessage.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "로그인이 필요합니다.", success: false },
        { status: 401 }
      );
    }
    if (errorMessage.includes("Forbidden")) {
      return NextResponse.json(
        { error: "권한이 없습니다.", success: false },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { 
        error: "서버 오류가 발생했습니다.", 
        details: errorMessage,
        success: false 
      },
      { status: 500 }
    );
  }
}

