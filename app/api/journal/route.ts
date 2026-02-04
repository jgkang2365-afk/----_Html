import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { assignAllNumbers } from "@/lib/utils/number-assignment";
import { toShortName } from "@/lib/constants/designated-offices";
import { fullNameToShortName } from "@/lib/utils/jurisdiction-matcher";
import { cleanToDigits, isValidDigitCount } from "@/lib/utils/business-number";

/**
 * 측정일지 등록 API
 * POST /api/journal - 측정일지 등록
 * GET /api/journal - 지원하지 않음 (검색은 /api/journal/search 사용)
 */
export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      error: "GET 메서드는 지원하지 않습니다.",
      message: "측정일지 검색은 /api/journal/search 엔드포인트를 사용하세요."
    },
    { status: 405 }
  );
}

export async function POST(request: NextRequest) {
  try {
    console.log(`[POST /api/journal] 요청 시작`);

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
    console.log(`[POST /api/journal] 요청 데이터: code=${body.code}, year=${body.measurement_year || body.measurementYear}, period=${body.measurement_period || body.measurementPeriod}`);

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

    // 자릿수 검증 (추가된 요구사항: 사업자 10자리, 산재/개시 11자리)
    const bNum = body.business_number || body.businessNumber;
    const sNum = body.industrial_accident_number || body.industrialAccidentNumber;
    const cNum = body.commencement_number || body.commencementNumber;

    if (!isValidDigitCount(bNum, 10)) {
      return NextResponse.json({ error: "사업자등록번호는 10자리 숫자(예: 3058641481)여야 합니다." }, { status: 400 });
    }
    if (!isValidDigitCount(sNum, 11)) {
      return NextResponse.json({ error: "산재관리번호는 11자리 숫자(예: 30586414810)여야 합니다." }, { status: 400 });
    }
    if (!isValidDigitCount(cNum, 11)) {
      return NextResponse.json({ error: "개시번호는 11자리 숫자(예: 00000000000)여야 합니다." }, { status: 400 });
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
    // 중복이 있을 경우 가장 최신 것만 사용
    console.log(`[POST /api/journal] 기존 측정일지 조회 시작: code=${code}, year=${measurementYear}, period=${measurementPeriod}`);

    const { data: allExistingJournals, error: existingError } = await supabase
      .from("measurement_journal")
      .select("id, code, business_name, document_number, sequence_number, five_plus_sequence, commencement_number, updated_at, created_at")
      .eq("code", code)
      .eq("measurement_year", measurementYear)
      .eq("measurement_period", measurementPeriod)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    console.log(`[POST /api/journal] 기존 측정일지 조회 결과: ${allExistingJournals?.length || 0}건`);

    const existingJournal = allExistingJournals && allExistingJournals.length > 0 ? allExistingJournals[0] : null;

    // 중복이 발견된 경우 경고 로그
    if (allExistingJournals && allExistingJournals.length > 1) {
      console.warn(`[POST /api/journal] 중복 측정일지 발견: code=${code}, year=${measurementYear}, period=${measurementPeriod}, 개수=${allExistingJournals.length}`, {
        ids: allExistingJournals.map((j: any) => j.id),
        document_numbers: allExistingJournals.map((j: any) => j.document_number)
      });
    }

    if (existingError && existingError.code !== "PGRST116") {
      console.error("기존 측정일지 조회 오류:", existingError);
      return NextResponse.json(
        { error: "기존 측정일지 확인 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (existingJournal) {
      console.log(`[POST /api/journal] 기존 측정일지 발견: id=${existingJournal.id}, document_number=${existingJournal.document_number || '(없음)'}`);

      // 기존 측정일지가 있지만 번호가 없는 경우, 번호를 부여하고 모든 필드를 업데이트
      const hasNumbers = existingJournal.document_number || existingJournal.sequence_number || existingJournal.five_plus_sequence;

      if (!hasNumbers) {
        console.log(`[POST /api/journal] 기존 측정일지에 번호 부여 시작: id=${existingJournal.id}`);
        // 번호가 없으면 자동으로 부여하고 모든 필드를 함께 업데이트
        const assignedNumbers = await assignAllNumbers({
          designated_office: designatedOffice,
          measurement_year: measurementYear,
          measurement_period: measurementPeriod,
          total_employees: total_employees || businessData.total_employees,
        });

        // body의 모든 필드를 포함한 업데이트 데이터 준비
        // PUT API와 동일한 방식으로 처리
        // 번호 필드 제외
        const { document_number, sequence_number, five_plus_sequence, ...bodyWithoutNumbers } = body;

        const updateData: any = {
          // 번호 필드
          document_number: assignedNumbers.document_number,
          sequence_number: assignedNumbers.sequence_number,
          five_plus_sequence: assignedNumbers.five_plus_sequence,
          commencement_number: cleanToDigits(body.commencement_number || businessData.commencement_number),
          // body에서 전달된 모든 필드 (번호 필드 제외)
          ...bodyWithoutNumbers,
          // 필수 필드 (body에 없으면 기존 값 유지)
          code: body.code || existingJournal.code,
          measurement_year: measurementYear,
          measurement_period: measurementPeriod,
          designated_office: designatedOffice,
          business_name: business_name || existingJournal.business_name,
          updated_by: user.name,
          updated_at: new Date().toISOString(),
        };

        // 빈 문자열을 null로 변환
        Object.keys(updateData).forEach((key) => {
          if (updateData[key] === "") {
            updateData[key] = null;
          }
        });

        // note 필드 처리
        if (body.note) {
          if (Array.isArray(body.note)) {
            updateData.note = body.note.join(',').substring(0, 50) || null;
          } else if (typeof body.note === 'string') {
            updateData.note = body.note.substring(0, 50) || null;
          }
        }

        // office_jurisdiction 정규화
        if (body.office_jurisdiction) {
          updateData.office_jurisdiction = fullNameToShortName(body.office_jurisdiction) || body.office_jurisdiction;
        }

        // 숫자 필드 변환
        if (updateData.total_employees) {
          updateData.total_employees = parseInt(String(updateData.total_employees)) || null;
        }
        if (updateData.measurement_fee_total) {
          updateData.measurement_fee_total = parseFloat(String(updateData.measurement_fee_total).replace(/,/g, '')) || null;
        }
        if (updateData.measurement_fee_business) {
          updateData.measurement_fee_business = parseFloat(String(updateData.measurement_fee_business).replace(/,/g, '')) || null;
        }
        if (updateData.measurement_fee_national) {
          updateData.measurement_fee_national = parseFloat(String(updateData.measurement_fee_national).replace(/,/g, '')) || null;
        }
        if (updateData.deposit_total) {
          updateData.deposit_total = parseFloat(String(updateData.deposit_total).replace(/,/g, '')) || null;
        }
        if (updateData.deposit_amount_business) {
          updateData.deposit_amount_business = parseFloat(String(updateData.deposit_amount_business).replace(/,/g, '')) || null;
        }
        if (updateData.deposit_amount_national) {
          updateData.deposit_amount_national = parseFloat(String(updateData.deposit_amount_national).replace(/,/g, '')) || null;
        }

        const { error: updateError } = await supabase
          .from("measurement_journal")
          .update(updateData)
          .eq("id", existingJournal.id);

        if (updateError) {
          console.error("측정일지 업데이트 오류:", updateError);
          return NextResponse.json(
            { error: "측정일지 업데이트 중 오류가 발생했습니다.", details: updateError.message },
            { status: 500 }
          );
        }

        // 중복 항목 삭제: 같은 code-year-period 조합의 다른 항목들 삭제
        // (방금 업데이트한 항목 제외)
        console.log(`[POST /api/journal] 중복 항목 확인 시작: code=${code}, year=${measurementYear}, period=${measurementPeriod}, excludeId=${existingJournal.id}`);

        const { data: duplicateJournals, error: findDuplicateError } = await supabase
          .from("measurement_journal")
          .select("id, document_number, sequence_number, created_at, updated_at")
          .eq("code", code)
          .eq("measurement_year", measurementYear)
          .eq("measurement_period", measurementPeriod)
          .neq("id", existingJournal.id);

        if (findDuplicateError) {
          console.error(`[POST /api/journal] 중복 측정일지 조회 오류:`, findDuplicateError);
        } else {
          console.log(`[POST /api/journal] 중복 측정일지 조회 결과: ${duplicateJournals?.length || 0}건`);

          if (duplicateJournals && duplicateJournals.length > 0) {
            const duplicateIds = duplicateJournals.map((j: any) => j.id);
            console.log(`[POST /api/journal] 중복 측정일지 발견: ${duplicateIds.length}건 삭제 시작`, {
              ids: duplicateIds,
              details: duplicateJournals.map((j: any) => ({
                id: j.id,
                document_number: j.document_number,
                sequence_number: j.sequence_number,
                created_at: j.created_at,
                updated_at: j.updated_at
              }))
            });

            const { error: deleteError, data: deleteData } = await supabase
              .from("measurement_journal")
              .delete()
              .in("id", duplicateIds)
              .select("id");

            if (deleteError) {
              console.error(`[POST /api/journal] 중복 측정일지 삭제 오류:`, deleteError);
              // 삭제 실패해도 업데이트는 성공했으므로 계속 진행
            } else {
              console.log(`[POST /api/journal] 중복 측정일지 정리 완료: ${duplicateIds.length}건 삭제됨`, {
                requested: duplicateIds,
                deleted: deleteData?.map((d: any) => d.id) || []
              });
            }
          } else {
            console.log(`[POST /api/journal] 중복 항목 없음`);
          }
        }

        // 업데이트 후 기존 측정일지 ID 반환
        return NextResponse.json({
          success: true,
          id: existingJournal.id,
          message: "기존 측정일지가 업데이트되었습니다.",
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

    // 번호 자동 부여 (수동 입력 값 우선)
    const manualDocumentNumber = body.document_number || null;
    const manualSequenceNumber = body.sequence_number || null;
    const manualFivePlusSequence = body.five_plus_sequence || null;
    const confirmDuplicate = body.confirm_duplicate === true;

    // 수동 입력된 번호에 대한 중복 체크 (confirmDuplicate가 false일 경우)
    if (!confirmDuplicate) {
      // 1. 공문연번 중복 체크 (년도별 유일)
      if (manualDocumentNumber) {
        const { data: existingDoc } = await supabase
          .from("measurement_journal")
          .select("id")
          .eq("designated_office", designatedOffice) // 약칭
          .eq("measurement_year", measurementYear)
          // .eq("measurement_period", measurementPeriod) // 공문연번은 주기 무관
          .eq("document_number", manualDocumentNumber)
          .maybeSingle();

        if (existingDoc) {
          return NextResponse.json(
            {
              error: "Duplicate Number",
              duplicateField: "공문연번",
              duplicateValue: manualDocumentNumber,
              message: `공문연번 "${manualDocumentNumber}"(은)는 이미 사용 중입니다. 중복을 허용하고 저장하시겠습니까?`
            },
            { status: 409 }
          );
        }
      }

      // 2. 연번 중복 체크 (년도+주기별 유일)
      if (manualSequenceNumber) {
        const { data: existingSeq } = await supabase
          .from("measurement_journal")
          .select("id")
          .eq("designated_office", designatedOffice)
          .eq("measurement_year", measurementYear)
          .eq("measurement_period", measurementPeriod)
          .eq("sequence_number", manualSequenceNumber)
          .maybeSingle();

        if (existingSeq) {
          return NextResponse.json(
            {
              error: "Duplicate Number",
              duplicateField: "연번",
              duplicateValue: manualSequenceNumber,
              message: `연번 "${manualSequenceNumber}"(은)는 이미 사용 중입니다. 중복을 허용하고 저장하시겠습니까?`
            },
            { status: 409 }
          );
        }
      }

      // 3. 5인 이상 연번 중복 체크 (년도+주기별 유일)
      if (manualFivePlusSequence) {
        const { data: existingFiveSeq } = await supabase
          .from("measurement_journal")
          .select("id")
          .eq("designated_office", designatedOffice)
          .eq("measurement_year", measurementYear)
          .eq("measurement_period", measurementPeriod)
          .eq("five_plus_sequence", manualFivePlusSequence)
          .maybeSingle();

        if (existingFiveSeq) {
          return NextResponse.json(
            {
              error: "Duplicate Number",
              duplicateField: "5인 이상 연번",
              duplicateValue: manualFivePlusSequence,
              message: `5인 이상 연번 "${manualFivePlusSequence}"(은)는 이미 사용 중입니다. 중복을 허용하고 저장하시겠습니까?`
            },
            { status: 409 }
          );
        }
      }
    }

    const assignedNumbers = await assignAllNumbers({
      designated_office: designatedOffice,
      measurement_year: measurementYear,
      measurement_period: measurementPeriod,
      total_employees: total_employees || businessData.total_employees,
      document_number: manualDocumentNumber,
      sequence_number: manualSequenceNumber,
      five_plus_sequence: manualFivePlusSequence,
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
      commencement_number: body.commencement_number || businessData.commencement_number || null,
      business_name: business_name || businessData.business_name,
      address: address || businessData.address,
      total_employees: total_employees || businessData.total_employees,
      office_jurisdiction: office_jurisdiction || businessData.office_jurisdiction,
      measurement_start_date: measurement_start_date || businessData.measurement_start_date,
      measurement_end_date: measurement_end_date || businessData.measurement_end_date,
      measurer: measurer || businessData.measurer,
      // business_info에서 가져오기
      business_number: cleanToDigits(body.business_number || businessInfo?.business_number || businessData.business_number),
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
      // measurement_business에서 담당자 정보 가져오기 (사용자 입력 값 우선)
      industrial_accident_number: cleanToDigits(body.industrial_accident_number || businessData.industrial_accident_number),
      manager_name: (() => {
        let name = body.manager_name || businessData.manager_name || null;
        let position = body.manager_position || businessData.manager_position || null;
        if (name && position) {
          const tName = name.trim();
          const tPos = position.trim();
          if (tName.endsWith(tPos)) {
            return tName.slice(0, -tPos.length).trim();
          }
        }
        return name;
      })(),
      manager_position: body.manager_position || businessData.manager_position || null,
      manager_mobile: body.manager_mobile || businessData.manager_mobile || null,
      manager_email: body.manager_email || businessData.manager_email || null,
      invoice_email: body.invoice_email || businessData.invoice_email || null,
      // 측정비 정보 (body에서 가져오기)
      measurement_fee_total: body.measurement_fee_total ? parseFloat(String(body.measurement_fee_total).replace(/,/g, '')) || null : null,
      measurement_fee_business: body.measurement_fee_business ? parseFloat(String(body.measurement_fee_business).replace(/,/g, '')) || null : null,
      measurement_fee_national: body.measurement_fee_national ? parseFloat(String(body.measurement_fee_national).replace(/,/g, '')) || null : null,
      // 입금 정보 (body에서 가져오기)
      deposit_total: body.deposit_total ? parseFloat(String(body.deposit_total).replace(/,/g, '')) || null : null,
      deposit_date_business: body.deposit_date_business || null,
      deposit_amount_business: body.deposit_amount_business ? parseFloat(String(body.deposit_amount_business).replace(/,/g, '')) || null : null,
      deposit_date_national: body.deposit_date_national || null,
      deposit_amount_national: body.deposit_amount_national ? parseFloat(String(body.deposit_amount_national).replace(/,/g, '')) || null : null,
      // K2B 정보 (body에서 가져오기)
      k2b_send_date: body.k2b_send_date || null,
      k2b_sender: body.k2b_sender || null,
      // 전자계산서 정보 (body에서 가져오기)
      electronic_invoice_date: body.electronic_invoice_date || null,
      // 특이사항 (body에서 가져오기)
      special_notes: body.special_notes || null,
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

    if (!planCheckError && existingPlan && newJournal) {
      // 계획이 있으면 등록 정보 업데이트
      const { error: planUpdateError } = await supabase
        .from("measurement_target_business")
        .update({
          journal_id: newJournal.id,
          is_registered: "확정",
          registered_at: new Date().toISOString(),
          measurement_start_date: journalData.measurement_start_date,
          measurement_end_date: journalData.measurement_end_date,
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

    if (!newJournal) {
      console.error("측정일지 생성 실패: newJournal이 null입니다.");
      return NextResponse.json(
        { error: "측정일지 생성에 실패했습니다." },
        { status: 500 }
      );
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

