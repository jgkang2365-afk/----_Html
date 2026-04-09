import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { canDeleteJournal } from "@/lib/permissions";
import { assignAllNumbers } from "@/lib/utils/number-assignment";
import { toShortName } from "@/lib/constants/designated-offices";
import { fullNameToShortName } from "@/lib/utils/jurisdiction-matcher";
import { cleanToDigits, isValidDigitCount } from "@/lib/utils/business-number";
import { syncBusinessToCalendar } from "@/lib/google/sync-service";

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

    // 자릿수 검증 (추가된 요구사항: 사업자 10자리, 산재/개시 11자리)
    const bNum = body.business_number;
    const sNum = body.industrial_accident_number;
    const cNum = body.commencement_number;

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

    // isAdmin 정의 (관리자)
    const isAdmin = user.role === "관리자";

    // 값 비교 헬퍼 함수
    const areValuesEqual = (val1: any, val2: any): boolean => {
      // null, undefined, 빈 문자열은 모두 같은 것으로 취급
      const v1 = val1 === null || val1 === undefined ? "" : String(val1).trim();
      const v2 = val2 === null || val2 === undefined ? "" : String(val2).trim();
      return v1 === v2;
    };

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

    // 완료된 측정일지 수정 제한 로직 (관리자는 모든 수정 허용)
    if (existingJournal.completion_status === "완료" && !isAdmin) {
      // 수정 불가능한 필드 정의 (공문연번, 연번, 5인 이상 연번, 측정자, 비고)
      // 비고(note) 필드에는 예비조사자명, 공시료 코드, 보고서 담당자 정보가 포함됨
      const lockedFields = [
        "document_number",
        "sequence_number",
        "five_plus_sequence",
        "measurer",
        "note",
        "k2b_sender"
      ];
      // 변경하려는 필드 중 제한된 필드가 있는지 확인
      const forbiddenChanges = Object.keys(body).filter(key => {
        // 제한된 필드가 아니면 통과
        if (!lockedFields.includes(key)) return false;

        // 값이 변경되었는지 확인
        const newValue = body[key];
        const oldValue = existingJournal[key];

        // 값이 다르면(변경되었으면) 차단
        if (!areValuesEqual(newValue, oldValue)) {
          console.log(`[측정일지 수정 차단] 완료 상태에서 제한된 필드 변경 시도: ${key} ("${oldValue}" -> "${newValue}")`);
          return true;
        }

        return false;
      });

      if (forbiddenChanges.length > 0) {
        // 한글 필드 명칭 매핑
        const fieldNameMap: Record<string, string> = {
          document_number: "공문연번",
          sequence_number: "연번",
          five_plus_sequence: "5인 이상 연번",
          measurer: "측정자",
          note: "비고(예비조사자, 공시료 코드 등)",
          k2b_sender: "보고서 담당자(K2B 전송자)"
        };

        const forbiddenNames = forbiddenChanges.map(f => fieldNameMap[f] || f);

        return NextResponse.json(
          {
            error: "완료된 측정일지의 일부 필드는 수정할 수 없습니다.",
            details: `수정 불가능한 필드가 변경되었습니다: ${forbiddenNames.join(", ")}`
          },
          { status: 403 }
        );
      }
    }

    // 번호 필드 변경 검증 (관리자만 직접 변경 가능)
    // isAdmin은 위에서 이미 정의됨
    const requestedDocumentNumber = body.document_number;
    const requestedSequenceNumber = body.sequence_number;
    const requestedFivePlusSequence = body.five_plus_sequence;

    // 일반 사용자가 번호 필드를 변경하려고 시도하는 경우
    if (!isAdmin) {
      const hasNumberChange =
        (requestedDocumentNumber !== undefined && requestedDocumentNumber !== existingJournal.document_number) ||
        (requestedSequenceNumber !== undefined && requestedSequenceNumber !== existingJournal.sequence_number) ||
        (requestedFivePlusSequence !== undefined && requestedFivePlusSequence !== existingJournal.five_plus_sequence);

      if (hasNumberChange) {
        return NextResponse.json(
          {
            error: "번호 필드는 관리자 승인이 필요합니다. 번호 변경 요청을 사용해주세요.",
            requiresApproval: true
          },
          { status: 403 }
        );
      }
    }

    // 공문연번, 연번은 관리자가 아닌 경우 기존 값 유지
    let documentNumber = existingJournal.document_number;
    let sequenceNumber = existingJournal.sequence_number;

    // 관리자인 경우 요청된 값 사용 (없으면 기존 값)
    // confirm_duplicate 플래그 확인 (중복 허용 여부)
    const confirmDuplicate = body.confirm_duplicate === true;

    // 관리자인 경우 요청된 값 사용 (없으면 기존 값)
    if (isAdmin) {
      // 1. 공문연번 처리 및 중복 확인
      if (requestedDocumentNumber !== undefined && requestedDocumentNumber !== null && requestedDocumentNumber !== "") {
        // 공문연번이 변경되는 경우이거나, 변경되지 않았더라도 중복 확인이 필요한 경우(강제 저장 시도 등)
        const isChanged = requestedDocumentNumber !== existingJournal.document_number;

        if (isChanged) {
          documentNumber = requestedDocumentNumber;

          if (!confirmDuplicate) {
            console.log(`[측정일지 수정] 관리자가 공문연번 변경 시도: ${existingJournal.document_number} → ${requestedDocumentNumber}`);

            // 공문연번 중복 확인 (같은 지정지청+측정년도 조합에서만 중복 확인 - 주기 무관)
            const designatedOfficeForCheck = body.designated_office
              ? (toShortName(body.designated_office) || body.designated_office)
              : existingJournal.designated_office;
            const measurementYearForCheck = body.measurement_year || existingJournal.measurement_year;
            // 공문연번은 주기와 상관없이 년도별로 유일해야 함 (lib/utils/number-assignment.ts 로직 기준)

            const officesToMatchForCheck = [designatedOfficeForCheck];
            const normalizedOfficeForCheck = toShortName(designatedOfficeForCheck);
            if (normalizedOfficeForCheck !== designatedOfficeForCheck) {
              officesToMatchForCheck.push(normalizedOfficeForCheck);
            }

            const { data: existingDocNumber, error: checkError } = await supabase
              .from("measurement_journal")
              .select("id")
              .in("designated_office", officesToMatchForCheck)
              .eq("measurement_year", measurementYearForCheck)
              // .eq("measurement_period", measurementPeriodForCheck) // 공문연번은 주기 무관
              .eq("document_number", requestedDocumentNumber)
              .neq("id", journalId) // 현재 측정일지 제외
              .maybeSingle();

            if (checkError) {
              console.error("[측정일지 수정] 공문연번 중복 확인 오류:", checkError);
              throw checkError;
            }

            if (existingDocNumber) {
              console.log(`[측정일지 수정] 공문연번 중복 발견: ${requestedDocumentNumber}`);
              return NextResponse.json(
                {
                  error: "Duplicate Number",
                  duplicateField: "공문연번",
                  duplicateValue: requestedDocumentNumber,
                  message: `공문연번 "${requestedDocumentNumber}"(은)는 이미 사용 중입니다. 중복을 허용하고 저장하시겠습니까?`
                },
                { status: 409 }
              );
            }
          }
        }
      }

      // 2. 연번 처리 및 중복 확인
      if (requestedSequenceNumber !== undefined && requestedSequenceNumber !== null && requestedSequenceNumber !== "") {
        const isChanged = requestedSequenceNumber !== existingJournal.sequence_number;

        if (isChanged) {
          sequenceNumber = requestedSequenceNumber;

          if (!confirmDuplicate) {
            // 연번 중복 확인 (같은 지정지청+측정년도+측정주기 조합)
            const designatedOfficeForCheck = body.designated_office
              ? (toShortName(body.designated_office) || body.designated_office)
              : existingJournal.designated_office;
            const measurementYearForCheck = body.measurement_year || existingJournal.measurement_year;
            const measurementPeriodForCheck = body.measurement_period || existingJournal.measurement_period;

            const officesToMatchForCheck = [designatedOfficeForCheck];
            const normalizedOfficeForCheck = toShortName(designatedOfficeForCheck);
            if (normalizedOfficeForCheck !== designatedOfficeForCheck) {
              officesToMatchForCheck.push(normalizedOfficeForCheck);
            }

            const { data: existingSeqNumber, error: checkError } = await supabase
              .from("measurement_journal")
              .select("id")
              .in("designated_office", officesToMatchForCheck)
              .eq("measurement_year", measurementYearForCheck)
              .eq("measurement_period", measurementPeriodForCheck)
              .eq("sequence_number", requestedSequenceNumber)
              .neq("id", journalId)
              .maybeSingle();

            if (checkError) throw checkError;

            if (existingSeqNumber) {
              return NextResponse.json(
                {
                  error: "Duplicate Number",
                  duplicateField: "연번",
                  duplicateValue: requestedSequenceNumber,
                  message: `연번 "${requestedSequenceNumber}"(은)는 이미 사용 중입니다. 중복을 허용하고 저장하시겠습니까?`
                },
                { status: 409 }
              );
            }
          }
        }
      }

      // 3. 5인 이상 연번 중복 확인은 아래 finalFivePlusSequence 계산 로직에서 처리
    }

    // designated_office 정규화 (약칭으로 저장) - Update: Trim input
    const designatedOfficeRaw = body.designated_office;
    const normalizedDesignatedOffice = designatedOfficeRaw
      ? toShortName(String(designatedOfficeRaw).trim())
      : existingJournal.designated_office;

    const finalDesignatedOffice = normalizedDesignatedOffice || existingJournal.designated_office;
    const finalMeasurementYear = body.measurement_year || existingJournal.measurement_year;

    // measurement_period - Update: Trim input
    const measurementPeriodRaw = body.measurement_period;
    const finalMeasurementPeriod = measurementPeriodRaw
      ? String(measurementPeriodRaw).trim()
      : existingJournal.measurement_period;
    const finalTotalEmployees = body.total_employees !== undefined ? body.total_employees : existingJournal.total_employees;

    // 5인 이상 연번 처리
    let finalFivePlusSequence: string;

    if (isAdmin && requestedFivePlusSequence !== undefined) {
      // 관리자가 직접 지정한 경우
      finalFivePlusSequence = requestedFivePlusSequence;

      // 5인 이상 연번 중복 확인
      if (!confirmDuplicate && finalFivePlusSequence !== existingJournal.five_plus_sequence) {
        const designatedOfficeForCheck = body.designated_office
          ? (toShortName(body.designated_office) || body.designated_office)
          : existingJournal.designated_office;
        const measurementYearForCheck = body.measurement_year || existingJournal.measurement_year;
        const measurementPeriodForCheck = body.measurement_period || existingJournal.measurement_period;

        const officesToMatchForCheck = [designatedOfficeForCheck];
        const normalizedOfficeForCheck = toShortName(designatedOfficeForCheck);
        if (normalizedOfficeForCheck !== designatedOfficeForCheck) {
          officesToMatchForCheck.push(normalizedOfficeForCheck);
        }

        const { data: existingFiveSeq, error: checkError } = await supabase
          .from("measurement_journal")
          .select("id")
          .in("designated_office", officesToMatchForCheck)
          .eq("measurement_year", measurementYearForCheck)
          .eq("measurement_period", measurementPeriodForCheck)
          .eq("five_plus_sequence", finalFivePlusSequence)
          .neq("id", journalId)
          .maybeSingle();

        if (checkError) {
          console.error("[측정일지 수정] 5인 이상 연번 중복 확인 오류:", checkError);
        } // 오류는 무시하고 진행하거나 throw 가능 (여기선 로그만)

        if (existingFiveSeq) {
          return NextResponse.json(
            {
              error: "Duplicate Number",
              duplicateField: "5인 이상 연번",
              duplicateValue: finalFivePlusSequence,
              message: `5인 이상 연번 "${finalFivePlusSequence}"(은)는 이미 사용 중입니다. 중복을 허용하고 저장하시겠습니까?`
            },
            { status: 409 }
          );
        }
      }
    } else {
      // 자동 재계산 방지벽 (조건부 재계산)
      // 1. 지정지청이 변경되었거나
      // 2. 측정년도가 변경되었거나
      // 3. 측정주기가 변경되었거나
      // 4. 총인원이 5인 미만 <-> 5인 이상으로 교차(Threshold 크로스)된 경우에만 재계산

      const isOfficeChanged = existingJournal.designated_office !== finalDesignatedOffice;
      const isYearChanged = existingJournal.measurement_year !== finalMeasurementYear;
      const isPeriodChanged = existingJournal.measurement_period !== finalMeasurementPeriod;

      const wasLessThan5 = existingJournal.total_employees < 5;
      const isNowLessThan5 = finalTotalEmployees < 5;
      const isEmployeeThresholdCrossed = wasLessThan5 !== isNowLessThan5;

      if (isOfficeChanged || isYearChanged || isPeriodChanged || isEmployeeThresholdCrossed) {
        console.log(`[측정일지 수정] 5인 연번 재계산 조건 충족 (지청변경:${isOfficeChanged}, 년도변경:${isYearChanged}, 주기변경:${isPeriodChanged}, 인원임계점변경:${isEmployeeThresholdCrossed}) -> 재계산 실행`);
        const { assignFivePlusSequenceNumber } = await import("@/lib/utils/number-assignment");
        finalFivePlusSequence = await assignFivePlusSequenceNumber(
          finalDesignatedOffice,
          finalMeasurementYear,
          finalMeasurementPeriod,
          finalTotalEmployees
        );
      } else {
        // 그 외의 단순 수정 (연락처, 비고, 오타 수정 등) 시에는 무조건 기존 번호 보존
        finalFivePlusSequence = existingJournal.five_plus_sequence;
        console.log(`[측정일지 수정] 5인 연번 재계산 조건 미충족 (단순 수정) -> 기존 번호(${finalFivePlusSequence}) 유지`);
      }
    }

    let finalDocumentNumber = documentNumber;
    let finalSequenceNumber = sequenceNumber;

    // 공문연번, 연번이 없으면 자동 부여 (신규 등록 시나리오)
    if (!finalDocumentNumber || !finalSequenceNumber) {
      const { assignAllNumbers } = await import("@/lib/utils/number-assignment");
      const assignedNumbers = await assignAllNumbers({
        designated_office: finalDesignatedOffice,
        measurement_year: finalMeasurementYear,
        measurement_period: finalMeasurementPeriod,
        total_employees: finalTotalEmployees,
        document_number: finalDocumentNumber,
        sequence_number: finalSequenceNumber,
        five_plus_sequence: null, // 5인 이상 연번은 이미 계산했으므로 null
      });

      finalDocumentNumber = assignedNumbers.document_number;
      finalSequenceNumber = assignedNumbers.sequence_number;
      // 5인 이상 연번은 위에서 계산한 값 사용
    }

    // office_jurisdiction 정규화 (약칭으로 저장)
    const normalizedOfficeJurisdiction = body.office_jurisdiction
      ? (fullNameToShortName(body.office_jurisdiction) || body.office_jurisdiction)
      : existingJournal.office_jurisdiction;

    // 업데이트 데이터 준비 (번호 필드는 제외하고, 자동으로 설정)
    const { document_number, sequence_number, five_plus_sequence, designated_office, office_jurisdiction, ...bodyWithoutNumbers } = body;

    // manager_name 정제 (이름에 직위가 포함된 경우 제거)
    if (bodyWithoutNumbers.manager_name && bodyWithoutNumbers.manager_position) {
      const tName = bodyWithoutNumbers.manager_name.trim();
      const tPos = bodyWithoutNumbers.manager_position.trim();
      if (tPos && tName.endsWith(tPos)) {
        bodyWithoutNumbers.manager_name = tName.slice(0, -tPos.length).trim();
      }
    }

    // 필드 길이 제한 적용 (데이터베이스 제약조건 준수)
    const truncateField = (value: any, maxLength: number, fieldName?: string): any => {
      if (value === null || value === undefined) return value;
      if (typeof value === 'string' && value.length > maxLength) {
        console.warn(`[필드 길이 제한] ${fieldName || '필드'} 값이 ${maxLength}자를 초과하여 잘립니다: ${value.substring(0, 30)}... (원본 길이: ${value.length}자)`);
        return value.substring(0, maxLength);
      }
      return value;
    };

    // 필드별 길이 제한 적용
    const updateData: any = {
      ...bodyWithoutNumbers,
      // VARCHAR(50) 제한 필드들 (기존 값이 있으면 유지, 없으면 새 값 사용)
      code: truncateField(bodyWithoutNumbers.code ?? existingJournal.code, 50, 'code'),
      note: truncateField(bodyWithoutNumbers.note ?? existingJournal.note, 500, 'note'),
      industrial_accident_number: cleanToDigits(bodyWithoutNumbers.industrial_accident_number ?? existingJournal.industrial_accident_number),
      commencement_number: cleanToDigits(bodyWithoutNumbers.commencement_number ?? existingJournal.commencement_number),
      // VARCHAR(20) 제한 필드들
      business_number: cleanToDigits(bodyWithoutNumbers.business_number ?? existingJournal.business_number),
      phone: truncateField(bodyWithoutNumbers.phone ?? existingJournal.phone, 20, 'phone'),
      fax: truncateField(bodyWithoutNumbers.fax ?? existingJournal.fax, 20, 'fax'),
      manager_mobile: truncateField(bodyWithoutNumbers.manager_mobile ?? existingJournal.manager_mobile, 20, 'manager_mobile'),
      // VARCHAR(10) 제한 필드들
      sequence_number: truncateField(finalSequenceNumber, 10, 'sequence_number'),
      five_plus_sequence: truncateField(finalFivePlusSequence, 10, 'five_plus_sequence'),
      // VARCHAR(20) 제한 필드 (공문연번)
      document_number: truncateField(finalDocumentNumber, 20, 'document_number'),
      // VARCHAR(200) 제한 필드 (업종)
      business_category: bodyWithoutNumbers.business_category !== undefined ? truncateField(bodyWithoutNumbers.business_category, 200, 'business_category') : existingJournal.business_category,
      // VARCHAR(255) 제한 필드 (계산서 발행처 상호)
      invoice_business_name: truncateField(bodyWithoutNumbers.invoice_business_name ?? existingJournal.invoice_business_name, 255, 'invoice_business_name'),
      // VARCHAR(20) 제한 필드 (계산서 발행처 사업자번호) 기초 데이터 클리닝 적용
      invoice_business_number: cleanToDigits(bodyWithoutNumbers.invoice_business_number ?? existingJournal.invoice_business_number),
      // 기타 필드
      designated_office: normalizedDesignatedOffice, // 약칭으로 저장
      office_jurisdiction: normalizedOfficeJurisdiction, // 약칭으로 저장
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
      console.error("[측정일지 수정] 업데이트 오류:", updateError);
      console.error("[측정일지 수정] 오류 코드:", updateError.code);
      console.error("[측정일지 수정] 오류 메시지:", updateError.message);
      console.error("[측정일지 수정] 최종 공문연번:", finalDocumentNumber);

      // 공문연번 중복 오류 처리
      if (updateError.code === '23505' && updateError.message.includes('document_number')) {
        console.error(`[측정일지 수정] 공문연번 중복: ${finalDocumentNumber}는 이미 사용 중`);
        return NextResponse.json(
          {
            error: "공문연번 중복 오류",
            details: `공문연번 "${finalDocumentNumber}"는 이미 다른 측정일지에서 사용 중입니다. 다른 번호를 선택해주세요.`
          },
          { status: 400 }
        );
      }

      // 필드 길이 초과 오류인 경우 상세 정보 출력
      if (updateError.code === '22001' && updateError.message.includes('too long')) {
        console.error("필드 길이 초과 오류 - 업데이트 데이터:", JSON.stringify(updateData, null, 2));

        // 각 필드의 길이 확인
        const fieldLengths: Record<string, number> = {};
        Object.keys(updateData).forEach(key => {
          if (typeof updateData[key] === 'string') {
            fieldLengths[key] = updateData[key].length;
          }
        });
        console.error("각 필드의 문자열 길이:", fieldLengths);

        // 50자를 초과하는 필드 찾기
        const tooLongFields = Object.entries(fieldLengths)
          .filter(([_, length]) => length > 50)
          .map(([field, length]) => `${field} (${length}자)`);

        if (tooLongFields.length > 0) {
          return NextResponse.json(
            {
              error: "필드 길이 초과 오류",
              details: `다음 필드가 50자를 초과합니다: ${tooLongFields.join(', ')}`,
              tooLongFields
            },
            { status: 400 }
          );
        }
      }

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
      // [Sync Priority 1] 국고지원, 업종분류 -> measurement_target_business (권위자)
      const { error: planUpdateError } = await supabase
        .from("measurement_target_business")
        .update({
          measurement_start_date: updatedJournal.measurement_start_date,
          measurement_end_date: updatedJournal.measurement_end_date,
          measurer: updatedJournal.measurer,
          business_name: updatedJournal.business_name,
          business_number: updatedJournal.business_number,
          total_employees: updatedJournal.total_employees,
          address: updatedJournal.address,
          office_jurisdiction: updatedJournal.office_jurisdiction,
          national_support_status: body.national_support_status || updatedJournal.national_support_status || null,
          manager_name: updatedJournal.manager_name,
          manager_mobile: updatedJournal.manager_mobile,
          manager_phone: updatedJournal.phone,
          business_category: updatedJournal.business_category,
        })
        .eq("id", existingPlan.id);

      if (planUpdateError) {
        console.error("측정 대상 사업장 계획 업데이트 오류:", planUpdateError);
        // 계획 업데이트 실패해도 측정일지 수정은 성공으로 처리
      }

      // [Sync Priority 2] 담당자 정보, 계산서 정보 -> measurement_business (마스터)
      try {
        const { error: masterSyncError } = await supabase
          .from("measurement_business")
          .update({
            manager_name: updatedJournal.manager_name,
            manager_position: updatedJournal.manager_position,
            manager_mobile: updatedJournal.manager_mobile,
            manager_email: updatedJournal.manager_email,
            invoice_email: updatedJournal.invoice_email,
            invoice_email_2: updatedJournal.invoice_email_2,
            business_category: updatedJournal.business_category,
            national_support_status: body.national_support_status || null,
            industrial_accident_number: updatedJournal.industrial_accident_number,
            total_employees: updatedJournal.total_employees,
            representative_name: updatedJournal.representative_name,
            phone: updatedJournal.phone,
            fax: updatedJournal.fax,
          })
          .eq("code", code)
          .eq("year", measurementYear)
          .eq("period", measurementPeriod);

        if (masterSyncError) {
          console.error("[PUT Sync] Master Business Sync Error:", masterSyncError);
        } else {
          console.log(`[PUT Sync] Updated master business info for ${code} (${measurementYear}/${measurementPeriod})`);
        }
      } catch (e) {
        console.error("[PUT Sync] Sync Exception:", e);
      }

      // [New Feature] 구글 캘린더 동기화 트리거
      try {
        await syncBusinessToCalendar(supabase, code, measurementYear, measurementPeriod);
        console.log(`[Journal Sync] Calendar sync triggered for ${code}`);
      } catch (syncError) {
        console.error(`[Journal Sync] Calendar sync failed for ${code}:`, syncError);
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

