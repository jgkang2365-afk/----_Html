import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { getKSTISOString } from "@/lib/utils/date-utils";
import { syncBusinessToCalendar } from "@/lib/google/sync-service";

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

    // 수정 불가 필드 및 measurement_journal에 없는 필드 제거
    const {
      document_number: _doc,
      sequence_number: _seq,
      five_plus_sequence: _five,
      journal_id,
      survey_id,
      id,
      created_at,
      updated_at,
      // measurement_journal에 없는 필드들 (summary에서만 사용)
      preliminary_surveyor,
      actual_measurer,
      report_writer,
      survey_code,
      survey_measurement_date,
      survey_end_date,
      survey_measurement_weekdays,
      business_name, // code로 관리되므로 제외
      ...updateData
    } = body;

    // national_support_status 빈 문자열을 null로 변환 및 값 정규화
    if (updateData.national_support_status === "" || updateData.national_support_status === undefined) {
      updateData.national_support_status = null;
    } else {
      // 프론트엔드에서 '대상'으로 올 수 있으므로 '지원'으로 변환 (제약조건: '지원', '비대상')
      const status = String(updateData.national_support_status).trim();
      if (status === "대상" || status === "지원") {
        updateData.national_support_status = "지원";
      } else if (status === "비대상") {
        updateData.national_support_status = "비대상";
      } else {
        // 그 외 유효하지 않은 값은 null 또는 기본적으로 비대상 등으로 처리할 수 있으나 여기선 null 설정
        updateData.national_support_status = null;
      }
    }

    // 날짜 필드 정규화 (빈 문자열을 null로 변환)
    if (updateData.measurement_start_date === "") updateData.measurement_start_date = null;
    if (updateData.measurement_end_date === "") updateData.measurement_end_date = null;
    if (updateData.k2b_send_date === "") updateData.k2b_send_date = null;
    if (updateData.electronic_invoice_date === "") updateData.electronic_invoice_date = null;
    if (updateData.deposit_date_business === "") updateData.deposit_date_business = null;
    if (updateData.deposit_date_national === "") updateData.deposit_date_national = null;

    // 번호 필드 정규화 (하이픈 등 특수문자 제거)
    const digitFields = ['business_number', 'industrial_accident_number', 'commencement_number', 'invoice_business_number'];
    digitFields.forEach(field => {
      if (updateData[field]) {
        updateData[field] = String(updateData[field]).replace(/[^\d]/g, "");
      }
    });

    const supabase = await createClient();

    // 측정일지 존재 확인
    const { data: existingJournal, error: checkError } = await supabase
      .from("measurement_journal")
      .select("*")
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

    // 금액 필드들 정규화 (문자열을 숫자로 변환)
    const amountFields = [
      'measurement_fee_total',
      'measurement_fee_business',
      'measurement_fee_national',
      'deposit_total',
      'deposit_amount_business',
      'deposit_amount_national'
    ];

    amountFields.forEach(field => {
      if (updateData[field] !== undefined) {
        if (typeof updateData[field] === "string") {
          const parsed = parseFloat(updateData[field].replace(/,/g, ""));
          updateData[field] = isNaN(parsed) ? null : parsed;
        }
      }
    });

    // measurement_journal 테이블에 있는 필드만 선택
    const allowedFields = [
      'code',
      'measurement_year',
      'measurement_period',
      'note',
      'designated_office',
      'measurement_start_date',
      'measurement_end_date',
      'completion_status',
      'measurer',
      'office_jurisdiction',
      'total_employees',
      'business_number',
      'industrial_accident_number',
      'representative_name',
      'national_support_status',
      'address',
      'phone',
      'fax',
      'manager_name',
      'manager_position',
      'manager_mobile',
      'manager_email',
      'k2b_send_date',
      'k2b_sender',
      'invoice_email',
      'invoice_email_2',
      'electronic_invoice_date',
      'commencement_number',
      'invoice_business_name',
      'invoice_business_number',
      'measurement_fee_total',
      'measurement_fee_business',
      'measurement_fee_national',
      'deposit_total',
      'deposit_date_business',
      'deposit_amount_business',
      'deposit_date_national',
      'deposit_amount_national',
      'special_notes',
    ];

    // 허용된 필드만 포함
    const filteredUpdateData: any = {};
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        filteredUpdateData[field] = updateData[field];
      }
    });

    // 측정일지 업데이트
    const { data: updatedJournal, error: updateError } = await supabase
      .from("measurement_journal")
      .update({
        ...filteredUpdateData,
        updated_by: user.name || user.id,
        updated_at: getKSTISOString(),
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

    // [New Feature] 구글 캘린더 동기화 트리거 및 대상 사업장 상태 업데이트
    try {
      const code = updatedJournal.code;
      const measurementYear = updatedJournal.measurement_year;
      const measurementPeriod = updatedJournal.measurement_period;

      // 1. 측정 대상 사업장 계획 업데이트 (진행률 파악 및 동기화 조건 충족을 위해)
      const { data: existingPlan } = await supabase
        .from("measurement_target_business")
        .select("id")
        .eq("code", code)
        .eq("year", measurementYear)
        .eq("period", measurementPeriod)
        .maybeSingle();

      if (existingPlan) {
        await supabase
          .from("measurement_target_business")
          .update({
            journal_id: updatedJournal.id,
            is_registered: "확정",
            registered_at: getKSTISOString(),
            measurement_start_date: updatedJournal.measurement_start_date,
            measurement_end_date: updatedJournal.measurement_end_date,
            measurer: updatedJournal.measurer,
            business_name: updatedJournal.business_name,
            business_number: updatedJournal.business_number,
            total_employees: updatedJournal.total_employees,
            address: updatedJournal.address,
            office_jurisdiction: updatedJournal.office_jurisdiction,
            national_support_status: updatedJournal.national_support_status || null,
            manager_name: updatedJournal.manager_name,
            manager_mobile: updatedJournal.manager_mobile,
          })
          .eq("id", existingPlan.id);
      }

      // 2. 구글 캘린더 동기화 실행
      await syncBusinessToCalendar(supabase, code, measurementYear, measurementPeriod);
      console.log(`[Summary Sync] Calendar sync triggered for ${code} (${measurementYear}/${measurementPeriod})`);
    } catch (syncError) {
      console.error(`[Summary Sync] Calendar sync failed:`, syncError);
    }

    return NextResponse.json({
      success: true,
      data: updatedJournal,
    });
  } catch (error: any) {
    console.error("측정정보 요약 수정 오류:", error);
    console.error("에러 상세:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return NextResponse.json(
      {
        error: error.message || "측정정보를 수정하는 중 오류가 발생했습니다.",
        details: error.message
      },
      { status: 500 }
    );
  }
}
