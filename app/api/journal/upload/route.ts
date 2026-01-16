/**
 * 측정일지 Excel 파일 업로드 API
 * POST /api/journal/upload
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { assignAllNumbers } from "@/lib/utils/number-assignment";
import { toShortName } from "@/lib/constants/designated-offices";
import { classifyDesignatedOffice, fullNameToShortName } from "@/lib/utils/jurisdiction-matcher";
import * as XLSX from "xlsx";

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

    // FormData에서 파일 추출
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "파일이 업로드되지 않았습니다." },
        { status: 400 }
      );
    }

    // Excel 파일 읽기
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, {
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellText: false,
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // 헤더 포함하여 읽기 (디버깅용)
    const rawDataWithHeader = XLSX.utils.sheet_to_json(worksheet, { 
      defval: null,
      header: 1, // 배열로 읽기 (첫 번째 행 확인용)
    });
    
    console.log("Excel 파일 읽기 결과:", {
      sheetName,
      totalRows: rawDataWithHeader.length,
      firstRow: rawDataWithHeader[0],
      secondRow: rawDataWithHeader[1],
    });
    
    // 객체 형태로 다시 읽기 (헤더를 키로 사용)
    const rawData = XLSX.utils.sheet_to_json(worksheet, { 
      defval: null,
      raw: false, // 텍스트로 읽기
    }) as Record<string, any>[];

    console.log("파싱된 데이터:", {
      totalRows: rawData.length,
      headers: rawData.length > 0 ? Object.keys(rawData[0]) : [],
      firstRowSample: rawData[0],
    });

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return NextResponse.json(
        { error: "Excel 파일에 데이터가 없습니다." },
        { status: 400 }
      );
    }

    // 헤더 행 제거 및 유효한 데이터 행 필터링
    // 첫 번째 행의 키들을 헤더로 간주
    const headerKeys = rawData.length > 0 ? Object.keys(rawData[0]) : [];
    console.log("감지된 헤더 키들:", headerKeys);
    
    // 헤더 이름이 "코드*" 또는 "코드"일 수 있음
    const codeKey = headerKeys.find(key => 
      key === "코드*" || key === "코드" || key.toLowerCase() === "code"
    ) || "코드";
    
    const dataRows = rawData.filter((row: any) => {
      // 모든 가능한 헤더 이름 조합 확인
      const code = row[codeKey] || row["코드*"] || row["코드"] || row["code"] || "";
      const codeStr = String(code).trim();
      
      // 빈 문자열이 아니고, 헤더로 보이는 값이 아닌 경우만 데이터로 간주
      if (!codeStr || codeStr === "코드" || codeStr === "코드*" || codeStr.toLowerCase() === "code") {
        return false;
      }
      
      // 숫자 값이 있는 경우도 확인 (측정년도 등)
      const hasValidData = codeStr || 
        row["측정년도*"] || row["측정년도"] || 
        row["사업장명*"] || row["사업장명"];
      
      return !!hasValidData;
    });

    console.log("필터링된 데이터 행 수:", dataRows.length);
    if (dataRows.length > 0) {
      console.log("첫 번째 데이터 행 샘플:", dataRows[0]);
    }

    if (dataRows.length === 0) {
      return NextResponse.json(
        { 
          error: "유효한 데이터 행이 없습니다.",
          details: `파일에서 읽은 헤더: ${rawData.length > 0 ? Object.keys(rawData[0] as Record<string, any>).join(", ") : "없음"}. '코드' 또는 '코드*' 컬럼을 확인해주세요.`
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // 각 행을 처리
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      try {
        // 필드명 매핑 (한국어 헤더 -> 데이터베이스 필드명)
        // 헤더 이름이 "*" 포함일 수 있음
        const code = String(
          row["코드*"] || row["코드"] || row["code"] || ""
        ).trim();
        const measurementYear = parseInt(
          row["측정년도*"] || row["측정년도"] || row["measurement_year"] || "0",
          10
        );
        const measurementPeriod = String(
          row["측정주기*"] || row["측정주기"] || row["measurement_period"] || ""
        ).trim();
        // 지정한계_관할지청 처리
        // 업로드 양식에는 약칭(천안, 대전, 평택, 경기)으로 저장되어 있음
        const designatedOfficeRaw = String(
          row["지정한계_관할지청*"] || row["지정한계_관할지청"] || row["designated_office"] || ""
        ).trim();
        let designatedOffice = toShortName(designatedOfficeRaw);
        
        const businessName = String(
          row["사업장명*"] || row["사업장명"] || row["business_name"] || ""
        ).trim();

        // 필수 필드 검증
        if (!code || !measurementYear || !measurementPeriod || !designatedOffice || !businessName) {
          errors.push(`행 ${i + 2}: 필수 필드가 누락되었습니다 (코드, 측정년도, 측정주기, 지정한계_관할지청, 사업장명)`);
          errorCount++;
          continue;
        }

        // measurement_business 테이블에서 확인
        const { data: businessData, error: businessError } = await supabase
          .from("measurement_business")
          .select("*")
          .eq("code", code)
          .eq("year", measurementYear)
          .eq("period", measurementPeriod)
          .maybeSingle();

        if (businessError) {
          errors.push(`행 ${i + 2}: 측정사업장 조회 오류 - ${businessError.message}`);
          errorCount++;
          continue;
        }

        // 날짜 파싱 헬퍼 함수
        const parseDate = (dateValue: any): string | null => {
          if (!dateValue) return null;
          if (dateValue instanceof Date) {
            return dateValue.toISOString().split("T")[0];
          }
          const dateStr = String(dateValue).trim();
          if (!dateStr || dateStr === "null" || dateStr === "undefined") return null;
          // YYYY-MM-DD 형식 검증
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
          }
          // Excel 날짜 숫자 변환 시도 (1900-01-01 기준)
          if (!isNaN(Number(dateStr)) && Number(dateStr) > 0) {
            try {
              // Excel 날짜는 1900-01-01부터의 일수 (실제로는 1900-01-01이 1이지만, 1899-12-30을 0으로 취급)
              const excelEpoch = new Date(1899, 11, 30); // 1899-12-30
              const days = Math.floor(Number(dateStr));
              const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
              if (!isNaN(date.getTime())) {
                return date.toISOString().split("T")[0];
              }
            } catch (e) {
              // 날짜 변환 실패 시 null 반환
            }
          }
          return null;
        };

        // 숫자 파싱 헬퍼 함수
        const parseNumber = (value: any): number | null => {
          if (value === null || value === undefined || value === "") return null;
          const num = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : Number(value);
          return isNaN(num) ? null : num;
        };

        // 예비조사 측정일 자동 채우기 (measurement_business.measurement_start_date가 비어있거나 불일치할 때)
        let autoFilledMeasurementDate = null;
        if (businessData && (!businessData.measurement_start_date || 
            (businessData.measurement_start_date && 
             parseDate(row["측정 시작일"] || row["measurement_start_date"]) && 
             parseDate(row["측정 시작일"] || row["measurement_start_date"]) !== businessData.measurement_start_date))) {
          // 같은 code의 가장 최근 예비조사 조회
          const { data: latestSurvey } = await supabase
            .from("preliminary_survey")
            .select("measurement_date")
            .eq("code", code)
            .order("measurement_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (latestSurvey?.measurement_date) {
            autoFilledMeasurementDate = latestSurvey.measurement_date;
          }
        }

        if (!businessData) {
          errors.push(
            `행 ${i + 2}: 측정사업장 정보를 찾을 수 없습니다.\n` +
            `  - 코드: ${code}\n` +
            `  - 측정년도: ${measurementYear}\n` +
            `  - 측정주기: ${measurementPeriod}\n` +
            `  원인: 측정사업장.xls 파일에 해당 코드의 ${measurementYear}년 ${measurementPeriod} 데이터가 없습니다.\n` +
            `  해결방법:\n` +
            `  1. 측정사업장.xls 파일에 코드 ${code}의 ${measurementYear}년 ${measurementPeriod} 데이터를 추가하세요.\n` +
            `  2. "측정사업장.xls 동기화" 기능을 실행하여 데이터베이스에 반영하세요.\n` +
            `  3. 동기화 완료 후 다시 Excel 업로드를 시도하세요.`
          );
          errorCount++;
          continue;
        }

        // 소재지 관할청 처리 (businessData 조회 이후)
        // office_jurisdiction은 약칭으로 저장
        const officeJurisdictionRaw = String(
          row["소재지 관할청"] || row["office_jurisdiction"] || businessData.office_jurisdiction || ""
        ).trim();
        
        // 소재지 관할청을 약칭으로 변환 (전체명이면 약칭으로, 이미 약칭이면 그대로)
        const officeJurisdiction = officeJurisdictionRaw 
          ? (fullNameToShortName(officeJurisdictionRaw) || officeJurisdictionRaw)
          : (businessData.office_jurisdiction || null);

        // 업종분류 처리: 엑셀에서 입력된 값이 있으면 사용, 없으면 지정지청이 "대전"이면 기본값 "공업사"
        let businessCategory = String(row["업종 분류"] || row["업종분류"] || row["business_category"] || "").trim() || null;
        
        // 엑셀에 업종분류가 없고 지정지청이 "대전"이면 기본값 "공업사"
        if (!businessCategory && designatedOffice === "대전") {
          businessCategory = "공업사";
        }
        
        // 지정한계_관할지청이 없으면 소재지 관할청을 기반으로 자동 계산
        if (!designatedOffice && officeJurisdiction) {
          designatedOffice = classifyDesignatedOffice(officeJurisdiction);
        }

        // 기존 측정일지 확인
        const { data: existingJournal, error: existingError } = await supabase
          .from("measurement_journal")
          .select("id")
          .eq("code", code)
          .eq("measurement_year", measurementYear)
          .eq("measurement_period", measurementPeriod)
          .maybeSingle();

        if (existingError && existingError.code !== "PGRST116") {
          errors.push(`행 ${i + 2}: 기존 측정일지 조회 오류 - ${existingError.message}`);
          errorCount++;
          continue;
        }

        if (existingJournal) {
          errors.push(`행 ${i + 2}: 이미 존재하는 측정일지입니다 (코드: ${code}, 년도: ${measurementYear}, 주기: ${measurementPeriod})`);
          errorCount++;
          continue;
        }

        // 번호 자동 부여 (없는 경우)
        let documentNumber = String(row["공문연번"] || row["document_number"] || "").trim();
        let sequenceNumber = String(row["연번"] || row["sequence_number"] || "").trim();
        let fivePlusSequence = String(row["5인 이상 연번"] || row["five_plus_sequence"] || "").trim();

        const totalEmployees = parseNumber(row["총인원"] || row["total_employees"]) || businessData.total_employees || null;

        // 공문연번 중복 확인: 지정한계_관할지청 + 측정년도 + 측정주기 조합에서만 중복 불가
        if (documentNumber) {
          const { data: existingDocNumber } = await supabase
            .from("measurement_journal")
            .select("id")
            .eq("designated_office", designatedOffice)
            .eq("measurement_year", measurementYear)
            .eq("measurement_period", measurementPeriod)
            .eq("document_number", documentNumber)
            .maybeSingle();
          
          if (existingDocNumber) {
            // 같은 지정한계_관할지청 + 측정년도 + 측정주기에서 중복된 공문연번이 있으면 자동 부여
            errors.push(`행 ${i + 2}: 공문연번 중복 (${documentNumber}) - 같은 지정한계_관할지청(${designatedOffice}) + 측정년도(${measurementYear}) + 측정주기(${measurementPeriod}) 조합에서 이미 존재합니다. 자동으로 새 번호를 부여합니다.`);
            documentNumber = "";
          }
        }

        // 연번 중복 확인: 지정한계_관할지청 + 측정년도 + 측정주기 조합에서만 중복 불가
        if (sequenceNumber) {
          const { data: existingSequenceNumber } = await supabase
            .from("measurement_journal")
            .select("id")
            .eq("designated_office", designatedOffice)
            .eq("measurement_year", measurementYear)
            .eq("measurement_period", measurementPeriod)
            .eq("sequence_number", sequenceNumber)
            .maybeSingle();
          
          if (existingSequenceNumber) {
            // 같은 지정한계_관할지청 + 측정년도 + 측정주기에서 중복된 연번이 있으면 자동 부여
            errors.push(`행 ${i + 2}: 연번 중복 (${sequenceNumber}) - 같은 지정한계_관할지청(${designatedOffice}) + 측정년도(${measurementYear}) + 측정주기(${measurementPeriod}) 조합에서 이미 존재합니다. 자동으로 새 번호를 부여합니다.`);
            sequenceNumber = "";
          }
        }

        // 5인 이상 연번은 중복 가능하므로 별도 체크 불필요

        if (!documentNumber || !sequenceNumber || !fivePlusSequence) {
          console.log(`[Excel 업로드] 행 ${i + 2}: 번호 자동 부여 시작`, {
            code,
            designated_office: designatedOffice,
            measurement_year: measurementYear,
            measurement_period: measurementPeriod,
            기존_공문연번: documentNumber || "(없음)",
            기존_연번: sequenceNumber || "(없음)",
            기존_5인이상연번: fivePlusSequence || "(없음)",
          });
          
          const assignedNumbers = await assignAllNumbers({
            designated_office: designatedOffice,
            measurement_year: measurementYear,
            measurement_period: measurementPeriod,
            total_employees: totalEmployees,
            document_number: documentNumber || null,
            sequence_number: sequenceNumber || null,
            five_plus_sequence: fivePlusSequence || null,
          });
          
          console.log(`[Excel 업로드] 행 ${i + 2}: 번호 자동 부여 완료`, {
            부여된_공문연번: assignedNumbers.document_number,
            부여된_연번: assignedNumbers.sequence_number,
            부여된_5인이상연번: assignedNumbers.five_plus_sequence,
          });
          
          documentNumber = documentNumber || assignedNumbers.document_number;
          sequenceNumber = sequenceNumber || assignedNumbers.sequence_number;
          fivePlusSequence = fivePlusSequence || assignedNumbers.five_plus_sequence;
        }

        // 측정일지 데이터 생성
        const journalData: any = {
          code,
          measurement_year: measurementYear,
          measurement_period: measurementPeriod,
          note: String(row["비고"] || row["note"] || "").trim() || null,
          designated_office: designatedOffice,
          document_number: documentNumber || null,
          sequence_number: sequenceNumber || null,
          five_plus_sequence: fivePlusSequence || null,
          business_name: businessName,
          total_employees: totalEmployees,
          office_jurisdiction: officeJurisdiction || null,
          business_category: businessCategory || null,
          measurement_start_date: parseDate(row["측정 시작일"] || row["measurement_start_date"]) || autoFilledMeasurementDate || businessData.measurement_start_date || null,
          measurement_end_date: parseDate(row["측정 종료일"] || row["measurement_end_date"]) || businessData.measurement_end_date || null,
          completion_status: String(row["완료여부"] || row["completion_status"] || "미완료").trim(),
          measurer: String(row["측정자"] || row["measurer"] || businessData.measurer || "").trim() || null,
          business_number: String(row["사업자번호"] || row["business_number"] || businessData.business_number || "").trim() || null,
          industrial_accident_number: String(row["산재관리번호"] || row["industrial_accident_number"] || "").trim() || null,
          representative_name: String(row["대표자명"] || row["representative_name"] || "").trim() || null,
          // 국고지원여부는 '지원' 또는 '비대상'만 허용, 그 외는 null
          national_support_status: (() => {
            const value = String(row["국고지원여부"] || row["national_support_status"] || "").trim();
            return value === "지원" || value === "비대상" ? value : null;
          })(),
          address: String(row["주소"] || row["address"] || businessData.address || "").trim() || null,
          phone: String(row["전화번호"] || row["phone"] || "").trim() || null,
          fax: String(row["팩스번호"] || row["fax"] || "").trim() || null,
          manager_name: String(row["담당자명"] || row["manager_name"] || "").trim() || null,
          manager_position: String(row["담당자 직위"] || row["manager_position"] || "").trim() || null,
          manager_mobile: String(row["담당자 휴대폰"] || row["manager_mobile"] || "").trim() || null,
          manager_email: String(row["담당자 이메일"] || row["manager_email"] || "").trim() || null,
          k2b_send_date: parseDate(row["K2B 발송일"] || row["k2b_send_date"]),
          k2b_sender: String(row["K2B 발송자"] || row["k2b_sender"] || "").trim() || null,
          invoice_email: String(row["계산서 e-mail"] || row["invoice_email"] || "").trim() || null,
          electronic_invoice_date: parseDate(row["전자계산서 발행일"] || row["electronic_invoice_date"]),
          measurement_fee_total: parseNumber(row["측정비(합계)"] || row["measurement_fee_total"]),
          measurement_fee_business: parseNumber(row["측정비(사업장)"] || row["measurement_fee_business"]),
          measurement_fee_national: parseNumber(row["측정비(국고)"] || row["measurement_fee_national"]),
          deposit_total: parseNumber(row["입금액(합계)"] || row["deposit_total"]),
          deposit_date_business: parseDate(row["입금일(사업장)"] || row["deposit_date_business"]),
          deposit_amount_business: parseNumber(row["입금액(사업장)"] || row["deposit_amount_business"]),
          deposit_date_national: parseDate(row["입금일(국고)"] || row["deposit_date_national"]),
          deposit_amount_national: parseNumber(row["입금액(국고)"] || row["deposit_amount_national"]),
          special_notes: String(row["특이사항"] || row["special_notes"] || "").trim() || null,
          created_by: user.name,
          updated_by: user.name,
        };

        // 측정일지 생성
        const { error: insertError } = await supabase
          .from("measurement_journal")
          .insert(journalData);

        if (insertError) {
          // 오류 메시지를 한국어로 명확하게 설명
          let errorMessage = `행 ${i + 2}: 측정일지 생성 오류`;
          
          if (insertError.message.includes("document_number_key")) {
            errorMessage = 
              `행 ${i + 2}: 공문연번 중복 오류\n` +
              `  - 입력된 공문연번: ${journalData.document_number || "(없음)"}\n` +
              `  - 원인: 동일한 공문연번이 이미 다른 측정일지에서 사용되고 있습니다.\n` +
              `  - 해결방법: Excel 파일의 공문연번을 비워두면 자동으로 새 번호가 부여됩니다.`;
          } else if (insertError.message.includes("national_support_status_check")) {
            errorMessage = 
              `행 ${i + 2}: 국고지원여부 입력 오류\n` +
              `  - 원인: 국고지원여부는 "지원" 또는 "비대상"만 입력 가능합니다.\n` +
              `  - 해결방법: Excel 파일의 국고지원여부 컬럼에 "지원" 또는 "비대상"을 입력하거나 비워두세요.`;
          } else if (insertError.message.includes("completion_status")) {
            errorMessage = 
              `행 ${i + 2}: 완료여부 입력 오류\n` +
              `  - 원인: 완료여부는 "완료" 또는 "미완료"만 입력 가능합니다.\n` +
              `  - 해결방법: Excel 파일의 완료여부 컬럼에 "완료" 또는 "미완료"를 입력하세요.`;
          } else {
            errorMessage = `행 ${i + 2}: 측정일지 생성 오류\n  - 오류 내용: ${insertError.message}`;
          }
          
          errors.push(errorMessage);
          errorCount++;
        } else {
          successCount++;
        }
      } catch (error) {
        errors.push(`행 ${i + 2}: 처리 오류 - ${error instanceof Error ? error.message : String(error)}`);
        errorCount++;
      }
    }

    return NextResponse.json({
      success: errorCount === 0,
      message: `${successCount}개 측정일지가 업로드되었습니다.`,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("측정일지 업로드 API 오류:", error);

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
        error: "측정일지 업로드 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
