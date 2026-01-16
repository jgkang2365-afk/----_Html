import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { assignAllNumbers } from "@/lib/utils/number-assignment";
import { toShortName } from "@/lib/constants/designated-offices";
import { fullNameToShortName } from "@/lib/utils/jurisdiction-matcher";

/**
 * 측정일지 등록 API
 * POST /api/journal
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    
    // 필드명 변환 (snake_case와 camelCase 모두 지원)
    const code = body.code;
    const measurementYear = body.measurement_year || body.measurementYear;
    const measurementPeriod = body.measurement_period || body.measurementPeriod;
    // note 필드 처리: 배열이면 콤마로 구분된 문자열로 변환, 문자열이면 그대로, 최대 50자로 제한
    let note: string | null = null;
    if (body.note) {
      if (Array.isArray(body.note)) {
        note = body.note.join(',').substring(0, 50);
      } else if (typeof body.note === 'string') {
        note = body.note.substring(0, 50);
      }
      // 빈 문자열이면 null로 변환
      if (note === '') note = null;
    }
    const designatedOfficeRaw = body.designated_office || body.designatedOffice;
    // 약칭으로 정규화하여 저장
    const designatedOffice = toShortName(designatedOfficeRaw);
    const business_name = body.business_name;
    const address = body.address;
    const total_employees = body.total_employees;
    // office_jurisdiction은 약칭으로 저장
    const office_jurisdictionRaw = body.office_jurisdiction;
    const office_jurisdiction = office_jurisdictionRaw ? fullNameToShortName(office_jurisdictionRaw) : null;
    const measurement_start_date = body.measurement_start_date;
    const measurement_end_date = body.measurement_end_date;
    const measurer = body.measurer;

    // 필수 필드 검증
    if (!code || !measurementYear || !measurementPeriod || !designatedOffice || !business_name) {
      return NextResponse.json(
        { 
          error: "필수 필드가 누락되었습니다.",
          details: {
            code: !!code,
            measurementYear: !!measurementYear,
            measurementPeriod: !!measurementPeriod,
            designatedOffice: !!designatedOffice,
            business_name: !!business_name,
          }
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // measurement_business 테이블에서 해당 code, year, period 조합이 존재하는지 확인
    const { data: businessData, error: businessError } = await supabase
      .from("measurement_business")
      .select("*")
      .eq("code", code)
      .eq("year", measurementYear)
      .eq("period", measurementPeriod)
      .maybeSingle();

    if (businessError) {
      console.error("측정사업장 조회 오류:", businessError);
      return NextResponse.json(
        { error: "측정사업장 정보를 확인하는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!businessData) {
      return NextResponse.json(
        { error: "해당 측정사업장 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // business_info 테이블에서 추가 정보 가져오기
    const { data: businessInfo, error: businessInfoError } = await supabase
      .from("business_info")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (businessInfoError && businessInfoError.code !== "PGRST116") {
      console.error("사업장정보 조회 오류:", businessInfoError);
      // business_info가 없어도 계속 진행 (필수 아님)
    }

    // 이미 측정일지가 존재하는지 확인 (번호 정보도 함께 조회)
    const { data: existingJournal, error: existingError } = await supabase
      .from("measurement_journal")
      .select("id, document_number, sequence_number, five_plus_sequence")
      .eq("code", code)
      .eq("measurement_year", measurementYear)
      .eq("measurement_period", measurementPeriod)
      .maybeSingle();

    if (existingError && existingError.code !== "PGRST116") {
      console.error("기존 측정일지 조회 오류:", existingError);
      return NextResponse.json(
        { error: "기존 측정일지 확인 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (existingJournal) {
      // 기존 측정일지가 있지만 번호가 없는 경우, 번호를 부여하고 업데이트
      const hasNumbers = existingJournal.document_number || existingJournal.sequence_number || existingJournal.five_plus_sequence;
      
      if (!hasNumbers) {
        // 번호가 없으면 자동으로 부여하고 업데이트
        const assignedNumbers = await assignAllNumbers({
          designated_office: designatedOffice,
          measurement_year: measurementYear,
          measurement_period: measurementPeriod,
          total_employees: total_employees || businessData.total_employees,
        });

        const { error: updateError } = await supabase
          .from("measurement_journal")
          .update({
            document_number: assignedNumbers.document_number,
            sequence_number: assignedNumbers.sequence_number,
            five_plus_sequence: assignedNumbers.five_plus_sequence,
            updated_by: user.name,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingJournal.id);

        if (updateError) {
          console.error("측정일지 번호 업데이트 오류:", updateError);
          return NextResponse.json(
            { error: "측정일지 번호 부여 중 오류가 발생했습니다.", details: updateError.message },
            { status: 500 }
          );
        }

        // 번호 부여 후 기존 측정일지 ID 반환
        return NextResponse.json({
          success: true,
          id: existingJournal.id,
          message: "기존 측정일지에 번호가 부여되었습니다.",
          assignedNumbers: assignedNumbers,
        });
      } else {
        // 번호가 이미 있는 경우, 기존 측정일지 정보 반환
        return NextResponse.json(
          { 
            error: "이미 해당 측정사업장의 측정일지가 존재합니다.",
            existingJournal: {
              id: existingJournal.id,
              document_number: existingJournal.document_number,
              sequence_number: existingJournal.sequence_number,
              five_plus_sequence: existingJournal.five_plus_sequence,
            }
          },
          { status: 409 }
        );
      }
    }

    // 번호 자동 부여
    const assignedNumbers = await assignAllNumbers({
      designated_office: designatedOffice,
      measurement_year: measurementYear,
      measurement_period: measurementPeriod,
      total_employees: total_employees || businessData.total_employees,
    });

    // 측정일지 데이터 생성 (business_info 및 measurement_business 정보 포함)
    const journalData = {
      code,
      measurement_year: measurementYear,
      measurement_period: measurementPeriod,
      note: note || null,
      designated_office: designatedOffice,
      document_number: assignedNumbers.document_number,
      sequence_number: assignedNumbers.sequence_number,
      five_plus_sequence: assignedNumbers.five_plus_sequence,
      business_name: business_name || businessData.business_name,
      address: address || businessData.address,
      total_employees: total_employees || businessData.total_employees,
      office_jurisdiction: office_jurisdiction || businessData.office_jurisdiction,
      measurement_start_date: measurement_start_date || businessData.measurement_start_date,
      measurement_end_date: measurement_end_date || businessData.measurement_end_date,
      measurer: measurer || businessData.measurer,
      // business_info에서 가져오기
      business_number: businessInfo?.business_number || businessData.business_number || null,
      representative_name: businessInfo?.representative_name || businessData.representative_name || null,
      phone: businessInfo?.phone || null,
      fax: businessInfo?.fax || null,
      // 업종분류: 지정지청이 "대전"이면 기본값 "공업사", 그 외는 null
      business_category: (() => {
        if (designatedOffice === "대전") {
          return "공업사";
        }
        return null;
      })(),
      // measurement_business에서 담당자 정보 가져오기
      industrial_accident_number: businessData.industrial_accident_number || null,
      manager_name: businessData.manager_name || null,
      manager_position: businessData.manager_position || null,
      manager_mobile: businessData.manager_mobile || null,
      manager_email: businessData.manager_email || null,
      invoice_email: businessData.invoice_email || null,
      completion_status: "미완료",
      created_by: user.name,
      updated_by: user.name,
    };

    // 측정일지 생성 (중복 시 재시도)
    let newJournal = null;
    let insertError = null;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      const { data, error } = await supabase
        .from("measurement_journal")
        .insert(journalData)
        .select("id")
        .single();
      
      if (!error) {
        newJournal = data;
        insertError = null;
        break;
      }
      
      // document_number 중복 오류인 경우에만 재시도
      if (error.message?.includes("document_number") && error.message?.includes("unique") && retryCount < maxRetries - 1) {
        console.warn(`공문연번 중복 감지, 재시도 ${retryCount + 1}/${maxRetries}: ${journalData.document_number}`);
        // 새로운 번호 부여
        const newAssignedNumbers = await assignAllNumbers({
          designated_office: designatedOffice,
          measurement_year: measurementYear,
          measurement_period: measurementPeriod,
          total_employees: total_employees || businessData.total_employees,
        });
        journalData.document_number = newAssignedNumbers.document_number;
        journalData.sequence_number = newAssignedNumbers.sequence_number;
        journalData.five_plus_sequence = newAssignedNumbers.five_plus_sequence;
        retryCount++;
        continue;
      }
      
      insertError = error;
      break;
    }

    if (insertError) {
      console.error("측정일지 생성 오류:", insertError);
      console.error("오류 상세:", JSON.stringify(insertError, null, 2));
      console.error("입력 데이터:", JSON.stringify(journalData, null, 2));
      
      // 더 자세한 오류 메시지 제공
      let errorMessage = "측정일지 생성 중 오류가 발생했습니다.";
      if (insertError.message?.includes("foreign key")) {
        errorMessage = `외래키 제약조건 오류: measurement_business 테이블에 코드 "${code}", 년도 "${measurementYear}", 주기 "${measurementPeriod}" 조합이 존재하지 않습니다.`;
      } else if (insertError.message?.includes("value too long")) {
        errorMessage = `데이터 길이 초과 오류: 일부 필드의 값이 허용된 길이를 초과했습니다. (${insertError.message})`;
      } else if (insertError.message?.includes("unique") || insertError.message?.includes("duplicate")) {
        errorMessage = `중복 오류: 이미 존재하는 데이터입니다. (${insertError.message})`;
      }
      
      return NextResponse.json(
        { 
          error: errorMessage, 
          details: insertError.message,
          code: insertError.code,
        },
        { status: 500 }
      );
    }

    // 측정 대상 사업장 계획 업데이트 (진행률 파악)
    // 해당 code, year, period의 계획이 있으면 등록 여부 및 정보 업데이트
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
          journal_id: newJournal.id,
          is_registered: true,
          registered_at: new Date().toISOString(),
          measurement_start_date: journalData.measurement_start_date,
          measurement_end_date: journalData.measurement_end_date,
          completion_status: journalData.completion_status,
          measurer: journalData.measurer,
          business_name: journalData.business_name,
          business_number: journalData.business_number,
          total_employees: journalData.total_employees,
          address: journalData.address,
          office_jurisdiction: journalData.office_jurisdiction,
          national_support_status: body.national_support_status || null,
          manager_name: journalData.manager_name,
          manager_mobile: journalData.manager_mobile,
          manager_phone: journalData.phone,
        })
        .eq("id", existingPlan.id);

      if (planUpdateError) {
        console.error("측정 대상 사업장 계획 업데이트 오류:", planUpdateError);
        // 계획 업데이트 실패해도 측정일지 등록은 성공으로 처리
      }
    }

    return NextResponse.json({
      success: true,
      id: newJournal.id,
      message: "측정일지가 등록되었습니다.",
    });
  } catch (error) {
    console.error("측정일지 등록 API 오류:", error);

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
        error: "측정일지 등록 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

