/**
 * Excel 파일 동기화 서비스
 * 사업장정보.xls와 측정사업장.xls 파일을 데이터베이스에 동기화합니다.
 */

import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

export interface SyncResult {
  success: boolean;
  file_name: string;
  records_processed: number;
  records_inserted: number;
  records_updated: number;
  error_message?: string;
}

export interface SyncLog {
  id?: number;
  file_name: string;
  sync_type: string;
  sync_start_time: Date;
  sync_end_time?: Date;
  status: "성공" | "실패" | "진행중";
  records_processed: number;
  records_updated: number;
  records_inserted: number;
  error_message?: string;
}

/**
 * Excel 파일을 읽어서 JSON 배열로 변환
 * 측정사업장.xlsx 파일은 첫 번째 행이 비어있고 두 번째 행이 헤더입니다.
 * 
 * @param filePathOrBuffer - 파일 경로 (string) 또는 파일 버퍼 (Buffer)
 * @returns 데이터 배열 (측정사업장 파일이 아닌 경우) 또는 { data, worksheet, headerRowIndex } 객체 (측정사업장 파일인 경우)
 */
function readExcelFile(filePathOrBuffer: string | Buffer, fileName?: string): any[] | { data: any[]; worksheet: XLSX.WorkSheet; headerRowIndex: number } {
  try {
    // 파일 경로 또는 Buffer에서 파일 버퍼 가져오기
    const fileBuffer = typeof filePathOrBuffer === "string"
      ? readFileSync(filePathOrBuffer)
      : filePathOrBuffer;

    const filePathForCheck = typeof filePathOrBuffer === "string"
      ? filePathOrBuffer
      : (fileName || "");
    const isMeasurementBusinessFile = filePathForCheck.includes("측정사업장") || fileName?.includes("measurement-business");

    const workbook = XLSX.read(fileBuffer, {
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellText: false
    });
    const sheetName = workbook.SheetNames[0]; // 첫 번째 시트 사용
    const worksheet = workbook.Sheets[sheetName];

    // 측정사업장.xlsx 파일은 첫 번째 행이 비어있고 두 번째 행이 헤더입니다.
    // range 옵션을 사용하여 두 번째 행부터 읽기 (헤더는 행 2, 데이터는 행 3부터)
    const range = worksheet["!ref"];
    if (!range) {
      return [];
    }

    const decodedRange = XLSX.utils.decode_range(range);

    // 첫 번째 행이 비어있는지 확인 (측정사업장.xlsx만 해당)
    const firstRowCell = XLSX.utils.encode_cell({ r: 0, c: 0 });
    const firstRowHasData = worksheet[firstRowCell] && String(worksheet[firstRowCell].v || "").trim();

    if (!firstRowHasData && isMeasurementBusinessFile) {
      // 첫 번째 행이 비어있으면 두 번째 행을 헤더로 사용
      // range를 조정하여 행 1부터 시작하도록 설정 (0-based index)
      const newRange = {
        s: { r: 1, c: decodedRange.s.c }, // 행 2부터 시작 (0-based index이므로 r: 1)
        e: { r: decodedRange.e.r, c: decodedRange.e.c }
      };
      const newRangeStr = XLSX.utils.encode_range(newRange);
      const data = XLSX.utils.sheet_to_json(worksheet, {
        defval: null,
        raw: false,
        range: newRangeStr
      });
      // 측정사업장 파일인 경우 워크시트 정보도 함께 반환 (BK 열 직접 읽기용)
      return { data, worksheet, headerRowIndex: 1 }; // headerRowIndex: 1 = 두 번째 행 (0-based)
    } else {
      // 기본 동작: 첫 번째 행을 헤더로 인식
      const data = XLSX.utils.sheet_to_json(worksheet, {
        defval: null,
        raw: false
      });
      return data;
    }
  } catch (error) {
    const filePathStr = typeof filePathOrBuffer === "string" ? filePathOrBuffer : (fileName || "Buffer");
    throw new Error(`Excel 파일 읽기 실패: ${filePathStr} - ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Storage에서 최신 파일을 가져오는 헬퍼 함수
 * @param fileType - "business-info" 또는 "measurement-business"
 * @returns 파일 버퍼와 파일명, 또는 null (파일이 없을 경우)
 */
async function getLatestFileFromStorage(fileType: "business-info" | "measurement-business"): Promise<{ buffer: Buffer; fileName: string } | null> {
  try {
    const supabase = await createClient();

    // Storage에서 파일 목록 조회 (최신순 정렬)
    const { data: files, error: listError } = await supabase.storage
      .from("excel-files")
      .list(fileType, {
        limit: 1,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (listError || !files || files.length === 0) {
      return null;
    }

    const latestFile = files[0];
    const filePath = `${fileType}/${latestFile.name}`;

    // 파일 다운로드
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("excel-files")
      .download(filePath);

    if (downloadError || !fileData) {
      return null;
    }

    // Blob을 Buffer로 변환
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return { buffer, fileName: latestFile.name };
  } catch (error) {
    console.error(`Storage에서 파일 가져오기 실패 (${fileType}):`, error);
    return null;
  }
}

/**
 * 사업장정보.xls 파일을 파싱하여 business_info 테이블 형식으로 변환
 * 실제 Excel 파일의 컬럼명에 맞게 매핑을 조정해야 합니다.
 */
function parseBusinessInfo(data: any[]): any[] {
  return data.map((row: any) => {
    // 실제 Excel 파일의 컬럼명에 맞게 매핑
    // 사업장정보.xlsx의 모든 컬럼 반영
    const baseData: any = {
      code: String(row["코드"] || "").trim(),
      business_name: String(row["사업장명"] || "").trim(),
      business_number: row["사업자번호"] || null,
      address1: row["주소1"] || null,
      address2: row["주소2"] || null,
      phone: row["전화번호"] || null,
      fax: row["팩스번호"] || null,
      representative_name: row["대표자명"] || null,
    };

    // 추가 필드들 (마이그레이션 후에만 저장됨)
    const optionalFields: any = {};

    // 우편번호
    if (row["우편번호"]) optionalFields.postal_code = String(row["우편번호"]).trim();

    // 업태, 업종
    if (row["업태"]) optionalFields.business_type = String(row["업태"]).trim();
    if (row["업종코드"]) optionalFields.business_category_code = String(row["업종코드"]).trim();
    if (row["업종"]) optionalFields.business_category = String(row["업종"]).trim();

    // 관할청 정보
    // 엑셀 파일의 실제 컬럼명 확인: "관할청" 또는 다른 변형 가능
    // null, undefined, 빈 문자열 모두 체크
    const officeJurisdictionValue = row["관할청"];
    if (officeJurisdictionValue !== undefined && officeJurisdictionValue !== null && officeJurisdictionValue !== "") {
      const trimmedValue = String(officeJurisdictionValue).trim();
      if (trimmedValue) {
        optionalFields.office_jurisdiction = trimmedValue;
      }
    }

    const officeCodeValue = row["관할청코드"] || null;
    if (officeCodeValue != null) {
      const trimmedValue = String(officeCodeValue).trim();
      if (trimmedValue) {
        optionalFields.office_code = trimmedValue;
      }
    }

    // 주생산품
    if (row["주생산품"]) optionalFields.main_product = String(row["주생산품"]).trim();

    // 근로자 수
    if (row["남근로수"]) optionalFields.male_employees = parseInt(String(row["남근로수"]), 10) || null;
    if (row["여근로수"]) optionalFields.female_employees = parseInt(String(row["여근로수"]), 10) || null;

    // 관리번호
    if (row["관리번호"]) optionalFields.management_number = String(row["관리번호"]).trim();

    // 계산서 관련
    if (row["계산서 메일"]) optionalFields.invoice_email = String(row["계산서 메일"]).trim();
    if (row["계산서 담당"]) optionalFields.invoice_manager = String(row["계산서 담당"]).trim();

    // 담당자 정보
    if (row["직위"]) optionalFields.manager_position = String(row["직위"]).trim();
    if (row["연락처"]) optionalFields.manager_contact = String(row["연락처"]).trim();

    // 년도
    if (row["년도"]) optionalFields.year = parseInt(String(row["년도"]), 10) || null;

    // 날짜 필드
    if (row["등록일"]) {
      const regDate = row["등록일"];
      if (typeof regDate === "number") {
        optionalFields.registration_date = excelDateToJSDate(regDate);
      } else {
        const dateStr = String(regDate).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          optionalFields.registration_date = dateStr;
        }
      }
    }

    if (row["향후측정예상일"]) {
      const futureDate = row["향후측정예상일"];
      if (typeof futureDate === "number") {
        optionalFields.future_measurement_date = excelDateToJSDate(futureDate);
      } else {
        const dateStr = String(futureDate).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          optionalFields.future_measurement_date = dateStr;
        }
      }
    }

    // 향후측정주기 (개월 단위, 예: 6, 12)
    // "1년", "6개월" 형식 지원
    if (row["향후측정주기"]) {
      const periodValue = row["향후측정주기"];
      if (typeof periodValue === "number") {
        optionalFields.future_measurement_period = Math.round(periodValue);
      } else {
        const periodStr = String(periodValue).trim();

        // "1년", "6개월" 형식 파싱
        if (periodStr.includes("년")) {
          const years = parseFloat(periodStr.replace("년", "").trim());
          if (!isNaN(years) && years > 0) {
            optionalFields.future_measurement_period = Math.round(years * 12);
          }
        } else if (periodStr.includes("개월")) {
          const months = parseFloat(periodStr.replace("개월", "").trim());
          if (!isNaN(months) && months > 0) {
            optionalFields.future_measurement_period = Math.round(months);
          }
        } else {
          // 숫자만 있는 경우
          const parsedPeriod = parseInt(periodStr, 10);
          if (!isNaN(parsedPeriod) && parsedPeriod > 0) {
            optionalFields.future_measurement_period = parsedPeriod;
          }
        }
      }
    }

    // 비고
    if (row["비고"]) optionalFields.notes = String(row["비고"]).trim();

    return { ...baseData, ...optionalFields };
  }).filter((row) => row.code && row.business_name); // 필수 필드 체크
}

/**
 * 측정사업장.xls 파일을 파싱하여 measurement_business 테이블 형식으로 변환
 * 실제 Excel 파일의 컬럼명에 맞게 매핑을 조정해야 합니다.
 */
/**
 * Excel 날짜를 JavaScript Date로 변환하는 헬퍼 함수
 */
function excelDateToJSDate(excelDate: number): string {
  // Excel 날짜는 1900년 1월 1일부터의 일수
  // Excel의 버그로 인해 1900년을 윤년으로 처리하므로 25569를 뺍니다
  const excelEpoch = new Date(1899, 11, 30);
  const jsDate = new Date(excelEpoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
  const year = jsDate.getFullYear();
  const month = String(jsDate.getMonth() + 1).padStart(2, "0");
  const day = String(jsDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 컬럼명 변형을 시도하여 값을 찾는 헬퍼 함수
 * 정확히 일치하는 컬럼을 우선으로 찾고, 없으면 유사한 이름을 시도합니다.
 */
function findColumnValue(row: any, columnNames: string[]): any {
  // 1단계: 정확히 일치하는 컬럼명 먼저 확인
  for (const name of columnNames) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
      return row[name];
    }
  }

  // 2단계: 공백만 제거하고 정확히 일치하는 컬럼 확인
  const keys = Object.keys(row);
  for (const name of columnNames) {
    const normalizedName = name.replace(/\s/g, "");
    for (const key of keys) {
      const normalizedKey = key.replace(/\s/g, "");
      if (normalizedKey === normalizedName) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
          return row[key];
        }
      }
    }
  }

  return null;
}


function parseMeasurementBusiness(data: any[], worksheet?: XLSX.WorkSheet, headerRowIndex?: number, fileName?: string): any[] {
  // 첫 번째 데이터 행에서 컬럼명 분석 (디버깅용)
  if (data.length > 0) {
    const firstRow = data[0];
    const keys = Object.keys(firstRow);

    // "코드" 컬럼의 정확한 이름 찾기 (정확히 일치하는 것만)
    const exactCodeColumn = keys.find(k => k === "코드");

    if (exactCodeColumn) {
      console.log(`[파싱] "코드" 컬럼 확인: 정확히 일치하는 컬럼 발견`);
    } else {
      // 정확히 일치하지 않으면 공백 제거 후 확인
      const spaceRemovedColumn = keys.find(k => k.replace(/\s/g, "") === "코드");
      if (spaceRemovedColumn) {
        console.log(`[파싱] "코드" 컬럼이 공백 포함 이름으로 발견됨: "${spaceRemovedColumn}"`);
      } else {
        console.warn(`[파싱] 경고: "코드" 컬럼을 찾을 수 없습니다!`);
      }
    }

    // BK 열 관련 컬럼 찾기 (담당자 휴대폰)
    // Excel 파일에서 BK 열 헤더는 "전화번호"
    const bkRelatedKeys = keys.filter(k =>
      k === "전화번호" ||
      k === "BK" ||
      k.includes("BK") ||
      (k.includes("담당자") && (k.includes("전화") || k.includes("휴대폰") || k.includes("폰")))
    );

    if (bkRelatedKeys.length > 0) {
      console.log(`[파싱] BK 열 관련 컬럼 발견:`, bkRelatedKeys);
      // 각 키에 대한 샘플 값 확인
      bkRelatedKeys.forEach(key => {
        const value = firstRow[key];
        if (value) {
          console.log(`[파싱]   - ${key}: ${value} (타입: ${typeof value})`);
        }
      });

      // "전화번호" 키가 있는지 확인
      if (keys.includes("전화번호")) {
        console.log(`[파싱] "전화번호" 컬럼 발견! 샘플 값: ${firstRow["전화번호"]}`);
      }
    } else {
      console.warn(`[파싱] 경고: BK 열(담당자 휴대폰) 관련 컬럼을 찾을 수 없습니다!`);
      console.warn(`[파싱] 사용 가능한 컬럼명 샘플:`, keys.slice(50, 70)); // BI, BJ, BK, BL 근처 컬럼명
    }
  }

  // 파일명에서 년도 추출 시도
  let defaultYear = new Date().getFullYear();
  let defaultPeriod = "상반기";

  if (fileName) {
    // 년도 추출 (예: 2026)
    const yearMatch = fileName.match(/20\d{2}/);
    if (yearMatch) {
      defaultYear = parseInt(yearMatch[0], 10);
      console.log(`[파싱] 파일명에서 년도 추출: ${defaultYear}`);
    }

    // 주기 추출
    if (fileName.includes("상반기")) defaultPeriod = "상반기";
    else if (fileName.includes("하반기")) defaultPeriod = "하반기";

    console.log(`[파싱] 파일명(${fileName}) 기반 기본값: 년도=${defaultYear}, 주기=${defaultPeriod}`);
  }



  return data.map((row: any, dataIndex: number) => {
    // Column Index Mapping (Based on verified structure)
    // 0: 측정년도, 1: 측정주기, 2: 코드, 7: 금회예정일, 8: 측정예정월, 9: 금회측정확정일(추정), 10: 업종분류
    const IDX_YEAR = 0;
    const IDX_PERIOD = 1;
    const IDX_CODE = 2;
    const IDX_FUTURE_DATE = 7;
    const IDX_FUTURE_MONTH = 8;
    const IDX_CONFIRMED_DATE = 9;
    const IDX_CATEGORY = 10;
    const IDX_BIZ_NAME = 11;
    const IDX_ADDRESS = 12;
    const IDX_MANAGER = 14;
    const IDX_MOBILE = 15;

    // Row might be an object (if headers parsed) or array (if header:1 used)
    // convert object values to array for index access if needed, BUT rely on keys if available
    // Here we assume row is object with keys. If keys are garbled, we might need value array.
    // However, findColumnValue searches by key names.

    // Fallback: Use Object.values(row) to access by index if keys are not standard
    const rowValues = Object.values(row);

    // 코드 값 찾기 - 정확히 일치하는 컬럼 우선 (Column 2)
    let codeValue = findColumnValue(row, ["코드", "코 드", "Code", "code", "CODE"]);
    if (!codeValue && rowValues[2]) codeValue = rowValues[2];

    // 년도 (Column 0) - 실제 엑셀 헤더명 "측정년도"
    let yearValue = row["측정년도"] || row["년도"];
    if (!yearValue && rowValues[0]) yearValue = rowValues[0];
    const rowYear = yearValue ? parseInt(String(yearValue), 10) : defaultYear;

    // 측정주기 (Column 1) - 실제 엑셀 헤더명 "측정주기"
    let period = row["측정주기"] || row["구분"] || defaultPeriod;
    if ((!period || period === defaultPeriod) && rowValues[1]) period = rowValues[1];

    // DB 제약사항(measurement_business_period_check) 준수를 위해 엄격 변환
    // 값이 없으면 무조건 '상반기'로 처리 (오류 방지)
    const periodStr = String(period || "").trim();
    const isSecondHalf = periodStr.includes("하반기") || periodStr.includes("하") || periodStr === "2" || periodStr === "2분기" || periodStr === "4분기";
    const normalizedPeriod = isSecondHalf ? "하반기" : "상반기";

    const completionStatus = row["완료여부"] || "미완료";
    const normalizedStatus = completionStatus.toString().includes("완료") && !completionStatus.toString().includes("미완료") ? "완료" : "미완료";

    // 날짜 변환 (Excel 날짜 또는 문자열 형식)
    let startDate = null;
    let endDate = null;
    let measurementDate = null; // 금회측정확정일 (Column 9)
    let futureMeasurementDate = null; // 금회예정일 (Column 7)

    const startDateStr = findColumnValue(row, ["측정시작일", "측정 시작일", "시작일"]);
    const endDateStr = findColumnValue(row, ["측정종료일", "측정 종료일", "종료일"]);

    // 금회측정확정일 (Column 9) - 실제 엑셀 헤더명 "금회측정확정일"
    let measurementDateStr = findColumnValue(row, ["금회측정확정일", "확정일", "측정확정일"]);
    if (!measurementDateStr && rowValues[9]) measurementDateStr = rowValues[9];

    // 금회예정일 (Column 7) - 실제 엑셀 헤더명 "금회예정일"
    let futureMeasurementDateStr = findColumnValue(row, ["금회예정일", "금회 예정일", "예정일"]);
    // Important: Fallback to column 7 if key lookup fails
    if (!futureMeasurementDateStr && rowValues[7]) futureMeasurementDateStr = rowValues[7];

    // 측정예정월 (Column 8) - 실제 엑셀 헤더명 "측정예정월"
    let futurePeriodStr = findColumnValue(row, ["측정예정월", "예정월"]);
    if (!futurePeriodStr && rowValues[8]) futurePeriodStr = rowValues[8];

    // 업종분류 (Column 10) - 실제 엑셀 헤더명 "업종분류"
    let businessCategory = findColumnValue(row, ["업종분류", "업종"]);
    if (!businessCategory && rowValues[10]) businessCategory = rowValues[10];

    // 전회측정일 (Excel 헤더: "전회측정일") - Column 5 - 선언을 여기로 이동
    const previousMeasurementDateVal = row["전회측정일"] || row["전회 측정일"] || rowValues[5] || null;

    // 날짜 파싱 헬퍼 함수 - 개선된 버전
    const parseDateValue = (dateVal: any): string | null => {
      if (!dateVal) return null;

      // 숫자형 처리
      if (typeof dateVal === "number") {
        // 20260130 같은 YYYYMMDD 형식의 숫자
        if (dateVal > 19000000 && dateVal < 21001231) {
          const dateStr = String(dateVal);
          if (dateStr.length === 8) {
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            return `${year}-${month}-${day}`;
          }
        }
        // Excel 날짜 시리얼 넘버 (1~50000 범위)
        if (dateVal > 1 && dateVal < 100000) {
          return excelDateToJSDate(dateVal);
        }
        return null;
      }

      // 문자열 처리
      const dateStr = String(dateVal).trim();
      if (!dateStr) return null;

      // 공백 제거
      const compactStr = dateStr.replace(/\s/g, "");

      // 1. YYYYMMDD 형식 (문자열)
      if (/^\d{8}$/.test(compactStr)) {
        const year = compactStr.substring(0, 4);
        const month = compactStr.substring(4, 6);
        const day = compactStr.substring(6, 8);
        return `${year}-${month}-${day}`;
      }

      // 2. YYYY-MM-DD 형식
      if (/^\d{4}-\d{2}-\d{2}$/.test(compactStr)) {
        return compactStr;
      }

      // 3. YYYY.MM.DD 또는 YYYY.M.D 형식
      if (compactStr.includes(".")) {
        const parts = compactStr.replace(/\.$/, "").split(".");
        if (parts.length >= 3) {
          const year = parts[0];
          const month = parts[1].padStart(2, "0");
          const day = parts[2].padStart(2, "0");
          return `${year}-${month}-${day}`;
        }
      }

      return null;
    };

    startDate = parseDateValue(startDateStr);
    endDate = parseDateValue(endDateStr);
    measurementDate = parseDateValue(measurementDateStr);
    futureMeasurementDate = parseDateValue(futureMeasurementDateStr);
    const previousMeasurementDate = parseDateValue(previousMeasurementDateVal);

    // 디버깅 로그 (첫 5개 행만)
    if (dataIndex < 5) {
      console.log(`[날짜 파싱] 행 ${dataIndex + 1}:`);
      console.log(`  - 코드: ${codeValue}`);
      console.log(`  - 금회예정일: "${futureMeasurementDateStr}" -> ${futureMeasurementDate}`);
      console.log(`  - 금회측정확정일: "${measurementDateStr}" -> ${measurementDate}`);
      console.log(`  - 전회측정일: "${previousMeasurementDateVal}" -> ${previousMeasurementDate}`);
    }

    // const businessCategory = findColumnValue(row, ["업종", "업종분류", "분류업종", "업태", "종목"]);
    // Already declared above as 'let businessCategory'

    // 기본 필드 구성 (실제 엑셀 헤더명에 맞춤)
    const baseData: any = {
      code: String(codeValue || "").trim(),
      year: rowYear, // Use the already-parsed year value (with fallback to defaultYear)
      period: normalizedPeriod,
      business_name: String(row["사업장명"] || rowValues[11] || "").trim(),
      business_number: row["사업자번호"] || null,
      total_employees: row["총인원"] ? parseInt(String(row["총인원"]), 10) : null,
      address: row["주소"] || rowValues[12] || null,
      office_jurisdiction: row["소재지 관할청"] || row["관할청명"] || row["소재지관할청"] || rowValues[13] || null,
      measurement_start_date: startDate || null,
      measurement_end_date: endDate || null,
      measurement_date: measurementDate || null, // 금회측정확정일
      future_measurement_date: futureMeasurementDate || null, // 금회예정일
      completion_status: normalizedStatus,
      measurer: row["계획담당자"] || row["주관담당자"] || null,
      national_support_status: row["국고결과"] || row["국고지원여부"] || row["국고지원"] || row["건강디딤돌"] || rowValues[3] || null,
      business_category: businessCategory,
    };

    // 담당자 정보 및 기타 정보는 마이그레이션 후에만 추가
    // 마이그레이션에 실행되지 않은 경우를 대비하여 조건부로 추가
    const optionalFields: any = {};

    // 담당자 정보 (여러 가능한 컬럼명 시도)
    const managerName = row["담당자명"] || row["담당자"] || row["담당자 성명"] || null;
    const managerPosition = row["직위"] || row["담당자 직위"] || null;

    // BK 열: Excel의 BK 열은 63번째 열 (A=1, B=2, ..., BK=63, 1-based)
    // xlsx 라이브러리의 sheet_to_json은 첫 번째 열을 0부터 시작하므로 BK는 인덱스 62 (0-based)
    // 중요: "전화번호" 헤더가 두 개 있음 (J열과 BK열). xlsx 라이브러리는 중복 헤더명이 있을 때 첫 번째 것만 사용하므로
    //       row["전화번호"]는 J열만 가리킴. 따라서 BK 열(담당자 휴대폰)은 반드시 워크시트에서 직접 읽어야 함
    let managerMobile: string | null = null;

    // 워크시트에서 담당자 휴대폰 열(BK열 등)을 직접 읽기
    // headerRowIndex가 undefined이면 0(첫 번째 행이 헤더)으로 가정
    const actualHeaderRowIndex = headerRowIndex !== undefined ? headerRowIndex : 0;

    if (worksheet) {
      const excelRowIndex = actualHeaderRowIndex + 1 + dataIndex;

      // BK열(62)을 중심으로 앞뒤 열(BJ=61, BL=63)도 함께 확인
      // 엑셀 인덱스 밀림이나 숨겨진 열 가능성 대비
      const candidates = [62, 61, 63];
      const foundValues: { [key: number]: string } = {};

      candidates.forEach(idx => {
        const cellAddress = XLSX.utils.encode_cell({ r: excelRowIndex, c: idx });
        const cell = worksheet[cellAddress];
        if (cell && cell.v !== undefined && cell.v !== null) {
          foundValues[idx] = String(cell.v).trim();
        }
      });

      // 디버깅: 첫 번째 행인 경우 값 출력
      if (dataIndex === 0) {
        console.log(`[담당자 휴대폰 탐색] 행: ${excelRowIndex}, 후보값들:`, foundValues);
      }

      // 우선순위 1: BK(62) 열이 휴대폰 번호 형식이면 채택
      // 휴대폰 번호 패턴: 010, 011 등으로 시작하고 "-" 또는 숫자가 이어짐
      const mobilePattern = /^01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}$/;
      // 좀 더 느슨한 패턴 (숫자와 하이픈만 포함, 길이 체크)
      const looseMobilePattern = /^\d{2,3}[-\s.]?\d{3,4}[-\s.]?\d{4}$/;

      let selectedMobile: string | null = null;

      // 1. 62(BK)열 검사 - 패턴 매칭되면 즉시 채택
      if (foundValues[62] && (mobilePattern.test(foundValues[62]) || looseMobilePattern.test(foundValues[62]))) {
        selectedMobile = foundValues[62];
      }
      // 2. 62번이 패턴 매칭이 안되면 61(BJ), 63(BL) 검사
      else if (foundValues[61] && (mobilePattern.test(foundValues[61]) || looseMobilePattern.test(foundValues[61]))) {
        selectedMobile = foundValues[61];
      }
      else if (foundValues[63] && (mobilePattern.test(foundValues[63]) || looseMobilePattern.test(foundValues[63]))) {
        selectedMobile = foundValues[63];
      }
      // 3. Fallback: 패턴 매칭 실패하더라도 62번에 값이 있고, 일반적인 텍스트(직위, 이메일 등)가 아니라면 사용
      // "보건관리자", "대표" 등이면 사용 안 함
      else if (foundValues[62] && !foundValues[62].includes("@") && foundValues[62].length > 4 &&
        !["사원", "대리", "과장", "차장", "부장", "대표", "이사", "상무", "전무", "팀장", "보건관리자", "연구원"].includes(foundValues[62])) {
        selectedMobile = foundValues[62];
      }

      if (selectedMobile) {
        managerMobile = selectedMobile;
        if (dataIndex === 0) {
          console.log(`[담당자 휴대폰 탐색] 최종 선택: ${managerMobile}`);
        }
      }
    }

    // 워크시트를 사용할 수 없는 경우, 여러 fallback 시도
    if (!managerMobile) {
      // 방법 1: __EMPTY_xx 키로 시도 (61, 62, 63)
      // 패턴 검사를 반드시 수행하여 직위 등이 들어가는 것 방지
      const mobilePattern = /^01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}$/;
      const looseMobilePattern = /^\d{2,3}[-\s.]?\d{3,4}[-\s.]?\d{4}$/;

      const fallbackKeys = ["__EMPTY_62", "__EMPTY_61", "__EMPTY_63"];

      for (const key of fallbackKeys) {
        if (row[key] !== undefined && row[key] !== null) {
          const value = String(row[key]).trim();
          if (value && (mobilePattern.test(value) || looseMobilePattern.test(value))) {
            managerMobile = value;
            if (dataIndex === 0) {
              console.log(`[Fallback 탐색] ${key}에서 휴대폰 번호 발견: ${managerMobile}`);
            }
            break;
          }
        }
      }
    }

    // 방법 2: 모든 컬럼에서 휴대폰 번호 패턴 찾기 (010-, 011-, 016-, 017-, 018-, 019-로 시작)
    if (!managerMobile) {
      const mobilePattern = /^(010|011|016|017|018|019)-\d{3,4}-\d{4}/;
      for (const [key, value] of Object.entries(row)) {
        if (value && typeof value === "string") {
          const strValue = String(value).trim();
          if (mobilePattern.test(strValue)) {
            // J열의 전화번호가 아닌 경우만 (일반 전화번호는 지역번호로 시작)
            if (!strValue.match(/^(02|031|032|033|041|042|043|044|051|052|053|054|055|061|062|063|064)-\d{3,4}-\d{4}/)) {
              managerMobile = strValue;
              // 디버깅: 첫 번째 행만 로그
              if (dataIndex === 0) {
                console.log(`[휴대폰 번호 패턴] 컬럼 "${key}"에서 휴대폰 번호 발견: ${managerMobile}`);
              }
              break;
            }
          }
        }
      }
      if (!managerMobile && dataIndex === 0) {
        console.log(`[휴대폰 번호 패턴] 휴대폰 번호 패턴을 찾지 못했습니다.`);
      }
    }



    const managerEmail = row["Email"] || row["이메일"] || row["담당자 e-mail"] || row["담당자 email"] || row["담당자이메일"] || null;
    const invoiceEmail = row["세금 Email"] || row["세금이메일"] || row["세금 Email"] || row["계산서 메일"] || row["계산서메일"] || null;
    const industrialAccidentNumber = row["산재관리번호"] || row["산재관리 번호"] || null;
    const representativeName = row["대표자명"] || row["대표자"] || null;

    // 값이 있는 경우에만 추가 (마이그레이션 후 컬럼이 있으면 저장됨)
    if (managerName) optionalFields.manager_name = managerName;
    if (managerPosition) optionalFields.manager_position = managerPosition;

    // manager_mobile은 null이더라도 항상 포함 (동기화 시 기존 잘못된 값을 덮어쓰기 위함)
    optionalFields.manager_mobile = managerMobile;

    if (managerEmail) optionalFields.manager_email = managerEmail;
    if (invoiceEmail) optionalFields.invoice_email = invoiceEmail;
    if (industrialAccidentNumber) optionalFields.industrial_accident_number = industrialAccidentNumber;
    if (representativeName) optionalFields.representative_name = representativeName;

    // 향후측정주기 (개월 단위, 예: 6, 12)
    // 여러 가능한 컬럼명 시도 - 실제 엑셀 헤더는 "전회 측정 주기"
    const futurePeriodValue = row["전회 측정 주기"] || row["전회측정주기"] || row["전회 향후측정주기"] || row["향후측정주기"] || row["측정주기"] || row["__EMPTY_6"] || null;

    // 향후측정주기 파싱 (전회 측정 주기)
    if (futurePeriodValue) {
      const periodValue = futurePeriodValue;
      const periodStr = String(periodValue).trim();

      // 헤더 텍스트는 건너뛰기
      if (periodStr &&
        periodStr !== "향후측정주기" &&
        periodStr !== "향후 측정주기" &&
        periodStr !== "전회 측정 주기" &&
        periodStr !== "전회측정주기") {

        if (typeof periodValue === "number") {
          optionalFields.future_measurement_period = Math.round(periodValue);
        } else {
          // "1년", "6개월" 형식 파싱
          if (periodStr.includes("년")) {
            const years = parseFloat(periodStr.replace(/년/g, "").trim());
            if (!isNaN(years) && years > 0) {
              optionalFields.future_measurement_period = Math.round(years * 12);
            }
          } else if (periodStr.includes("개월")) {
            const months = parseFloat(periodStr.replace(/개월/g, "").trim());
            if (!isNaN(months) && months > 0) {
              optionalFields.future_measurement_period = Math.round(months);
            }
          } else {
            // 숫자만 있는 경우
            const parsedPeriod = parseInt(periodStr.replace(/[^0-9]/g, ""), 10);
            if (!isNaN(parsedPeriod) && parsedPeriod > 0 && parsedPeriod <= 60) {
              optionalFields.future_measurement_period = parsedPeriod;
            }
          }
        }

        // 디버깅 로그 (첫 5개 행만)
        if (dataIndex < 5 && optionalFields.future_measurement_period) {
          console.log(`[전회 측정 주기 파싱] 행 ${dataIndex + 1}: "${periodStr}" -> ${optionalFields.future_measurement_period}개월`);
        }
      }
    }

    // 전회측정일 저장 (이미 위에서 파싱됨)
    if (previousMeasurementDate) {
      optionalFields.previous_measurement_date = previousMeasurementDate;
    }

    // 회사전화번호 (Excel 헤더: "회사전화번호")
    const companyPhone = row["회사전화번호"] || row["회사 전화번호"] || rowValues[16] || null;
    // 단, "전화번호"는 BK 열 검사에서 제외된 일반 전화번호여야 함. 매니저 정보 파싱 로직에서 처리됨. 
    // 그러나 여기서 명시적으로 회사전화번호 헤더가 있으면 그것을 우선 사용.
    if (companyPhone) {
      // 전화번호 패턴 검사 (지역번호 포함)
      const phoneStr = String(companyPhone).trim();
      if (phoneStr.match(/^(02|031|032|033|041|042|043|044|051|052|053|054|055|061|062|063|064)-\d{3,4}-\d{4}/)) {
        optionalFields.manager_phone = phoneStr;
      } else if (!optionalFields.manager_phone && phoneStr) {
        // manager_phone이 아직 없고 값이 있으면 일단 넣음 (패턴이 안 맞더라도)
        optionalFields.manager_phone = phoneStr;
      }
    }

    // 비고 (Column 17) - 실제 엑셀 헤더명 "비고"
    const notes = row["비고"] || rowValues[17] || null;
    if (notes) optionalFields.notes = String(notes).trim();

    return { ...baseData, ...optionalFields };
  }).filter((row: any) => row.code && row.year && row.period && row.business_name); // 필수 필드 체크
}

/**
 * 사업장정보.xls 파일을 동기화
 */
export async function syncBusinessInfo(filePath?: string): Promise<SyncResult> {
  // .xlsx와 .xls 모두 지원
  const fileNameXlsx = "사업장정보.xlsx";
  const fileNameXls = "사업장정보.xls";
  const defaultPathXlsx = join(process.cwd(), fileNameXlsx);
  const defaultPathXls = join(process.cwd(), fileNameXls);

  const syncStartTime = new Date();
  let logId: number | null = null;
  let fileName = fileNameXlsx; // catch 블록에서 사용할 수 있도록 함수 상단에서 선언

  try {
    const supabase = await createClient();

    // 파일 소스 결정: Storage 우선, 로컬 파일 fallback
    let excelData: any[];
    let targetPath: string | Buffer | undefined = filePath;
    let fileBuffer: Buffer | undefined;
    let storageFileName: string | undefined;

    if (!targetPath) {
      // Storage에서 최신 파일 가져오기 시도
      const storageFile = await getLatestFileFromStorage("business-info");
      if (storageFile) {
        fileBuffer = storageFile.buffer;
        storageFileName = storageFile.fileName;
        fileName = storageFile.fileName;
        targetPath = fileBuffer;
      } else {
        // Storage에 파일이 없으면 로컬 파일 사용
        if (existsSync(defaultPathXlsx)) {
          targetPath = defaultPathXlsx;
          fileName = fileNameXlsx;
        } else if (existsSync(defaultPathXls)) {
          targetPath = defaultPathXls;
          fileName = fileNameXls;
        } else {
          throw new Error(`Excel 파일을 찾을 수 없습니다: ${fileNameXlsx} 또는 ${fileNameXls}`);
        }
      }
    } else {
      // filePath가 지정된 경우 (로컬 파일 경로)
      if (typeof targetPath === "string") {
        fileName = targetPath.includes(".xlsx") ? fileNameXlsx : fileNameXls;
        if (!existsSync(targetPath)) {
          throw new Error(`Excel 파일을 찾을 수 없습니다: ${targetPath}`);
        }
      } else {
        throw new Error("파일 경로가 올바르지 않습니다.");
      }
    }

    // 동기화 로그 시작
    const { data: logData, error: logError } = await supabase
      .from("sync_log")
      .insert({
        file_name: fileName,
        sync_type: "사업장정보",
        sync_start_time: syncStartTime.toISOString(),
        status: "진행중",
        records_processed: 0,
        records_updated: 0,
        records_inserted: 0,
      })
      .select("id")
      .single();

    if (logError) {
      console.error("동기화 로그 생성 실패:", logError);
    } else {
      logId = logData.id;
    }

    // Excel 파일 읽기
    const readResult = fileBuffer
      ? readExcelFile(fileBuffer, storageFileName)
      : readExcelFile(targetPath as string);

    // readExcelFile의 반환값이 객체인 경우 (측정사업장 파일)
    if (readResult && typeof readResult === "object" && "data" in readResult) {
      excelData = readResult.data;
    } else {
      excelData = readResult as any[];
    }

    // 디버깅: "관할청" 컬럼이 있는 행 찾기
    let sampleRowWithOffice = null;
    for (let i = 0; i < Math.min(excelData.length, 50); i++) {
      const row = excelData[i];
      if (row["관할청"] && String(row["관할청"]).trim()) {
        sampleRowWithOffice = row;
        console.log(`관할청 데이터가 있는 행 발견 (인덱스 ${i}):`, {
          "코드": row["코드"],
          "사업장명": row["사업장명"],
          "관할청": row["관할청"],
          "관할청코드": row["관할청코드"],
        });
        break;
      }
    }

    if (!sampleRowWithOffice) {
      console.warn("경고: 엑셀 파일에서 '관할청' 데이터가 있는 행을 찾을 수 없습니다.");
      // 첫 5개 행 샘플 출력
      for (let i = 0; i < Math.min(excelData.length, 5); i++) {
        const row = excelData[i];
        console.log(`행 ${i} 샘플:`, {
          "코드": row["코드"],
          "사업장명": row["사업장명"],
          "관할청": row["관할청"],
          "관할청코드": row["관할청코드"],
        });
      }
    }

    const parsedData = parseBusinessInfo(excelData);

    // 파싱된 데이터 샘플 확인
    const parsedSampleWithOffice = parsedData.find(p => p.office_jurisdiction);
    if (parsedSampleWithOffice) {
      console.log("파싱된 데이터 샘플 (office_jurisdiction 있음):", {
        "코드": parsedSampleWithOffice.code,
        "사업장명": parsedSampleWithOffice.business_name,
        "office_jurisdiction": parsedSampleWithOffice.office_jurisdiction,
      });
    } else {
      console.warn("경고: 파싱된 데이터에서 office_jurisdiction이 있는 행을 찾을 수 없습니다.");
    }

    let recordsInserted = 0;
    let recordsUpdated = 0;

    // 성능 최적화: 모든 code를 한 번에 조회하여 기존 데이터 맵 생성
    const codes = parsedData.map(row => row.code).filter(Boolean);
    const existingCodesSet = new Set<string>();

    if (codes.length > 0) {
      // 배치로 기존 code 조회 (1000개씩 나눠서 조회)
      const batchSize = 1000;
      for (let i = 0; i < codes.length; i += batchSize) {
        const codeBatch = codes.slice(i, i + batchSize);
        const { data: existingCodes, error: selectError } = await supabase
          .from("business_info")
          .select("code")
          .in("code", codeBatch);

        if (selectError) {
          console.error("기존 코드 배치 조회 오류:", selectError);
        } else if (existingCodes) {
          existingCodes.forEach(item => {
            if (item.code) {
              existingCodesSet.add(item.code);
            }
          });
        }
      }
    }

    // 데이터를 삽입/업데이트로 분류
    const toInsert: any[] = [];
    const toUpdate: any[] = [];
    const now = new Date().toISOString();

    parsedData.forEach(row => {
      if (!row.code) return;

      const rowWithTimestamp = {
        ...row,
        updated_at: now,
      };

      if (existingCodesSet.has(row.code)) {
        toUpdate.push(rowWithTimestamp);
      } else {
        toInsert.push(row);
      }
    });

    // 배치 삽입 (1000개씩)
    if (toInsert.length > 0) {
      const insertBatchSize = 1000;
      for (let i = 0; i < toInsert.length; i += insertBatchSize) {
        const batch = toInsert.slice(i, i + insertBatchSize);
        const { error: insertError } = await supabase
          .from("business_info")
          .insert(batch);

        if (insertError) {
          // 마이그레이션이 실행되지 않은 경우, 기본 필드만 삽입 시도
          if (insertError.code === "PGRST204" || insertError.message?.includes("column") || insertError.message?.includes("does not exist")) {
            console.warn("마이그레이션이 필요할 수 있습니다. 기본 필드만 삽입 시도...");
            const basicBatch = batch.map(row => ({
              code: row.code,
              business_name: row.business_name,
              business_number: row.business_number,
              address1: row.address1,
              address2: row.address2,
              phone: row.phone,
              fax: row.fax,
              representative_name: row.representative_name,
            }));

            const { error: basicInsertError } = await supabase
              .from("business_info")
              .insert(basicBatch);

            if (basicInsertError) {
              console.error(`배치 삽입 오류 (${i}~${i + batch.length}):`, basicInsertError);
            } else {
              recordsInserted += batch.length;
            }
          } else {
            console.error(`배치 삽입 오류 (${i}~${i + batch.length}):`, insertError);
          }
        } else {
          recordsInserted += batch.length;
        }
      }
    }

    // 배치 업데이트 (Supabase는 upsert를 사용할 수 있지만, 여기서는 배치 업데이트)
    // 개별 업데이트가 필요하므로 병렬 처리로 최적화
    if (toUpdate.length > 0) {
      const updateBatchSize = 100; // 업데이트는 더 작은 배치로
      const updatePromises: Promise<void>[] = [];

      for (let i = 0; i < toUpdate.length; i += updateBatchSize) {
        const batch = toUpdate.slice(i, i + updateBatchSize);

        // 각 레코드를 병렬로 업데이트
        batch.forEach(row => {
          const promise = supabase
            .from("business_info")
            .update(row)
            .eq("code", row.code)
            .then(({ error: updateError }) => {
              if (updateError) {
                // 마이그레이션이 실행되지 않은 경우, 기본 필드만 업데이트 시도
                if (updateError.code === "PGRST204" || updateError.message?.includes("column") || updateError.message?.includes("does not exist")) {
                  return supabase
                    .from("business_info")
                    .update({
                      business_name: row.business_name,
                      business_number: row.business_number,
                      address1: row.address1,
                      address2: row.address2,
                      phone: row.phone,
                      fax: row.fax,
                      representative_name: row.representative_name,
                      updated_at: now,
                    })
                    .eq("code", row.code)
                    .then(({ error: basicUpdateError }) => {
                      if (basicUpdateError) {
                        console.error(`코드 ${row.code} 기본 필드 업데이트 오류:`, basicUpdateError);
                      } else {
                        recordsUpdated++;
                      }
                      return Promise.resolve<void>(undefined);
                    });
                } else {
                  console.error(`코드 ${row.code} 업데이트 오류:`, updateError);
                  return Promise.resolve<void>(undefined);
                }
              } else {
                recordsUpdated++;
                return Promise.resolve<void>(undefined);
              }
            });

          updatePromises.push(Promise.resolve(promise).then(() => undefined));
        });
      }

      // 모든 업데이트 완료 대기
      await Promise.all(updatePromises);
    }

    const syncEndTime = new Date();

    // 동기화 로그 업데이트
    if (logId) {
      await supabase
        .from("sync_log")
        .update({
          sync_end_time: syncEndTime.toISOString(),
          status: "성공",
          records_processed: parsedData.length,
          records_updated: recordsUpdated,
          records_inserted: recordsInserted,
        })
        .eq("id", logId);
    }

    return {
      success: true,
      file_name: fileName,
      records_processed: parsedData.length,
      records_inserted: recordsInserted,
      records_updated: recordsUpdated,
    };
  } catch (error) {
    const syncEndTime = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 동기화 로그 업데이트 (실패)
    if (logId) {
      const supabase = await createClient();
      await supabase
        .from("sync_log")
        .update({
          sync_end_time: syncEndTime.toISOString(),
          status: "실패",
          error_message: errorMessage,
        })
        .eq("id", logId);
    }

    return {
      success: false,
      file_name: fileName,
      records_processed: 0,
      records_inserted: 0,
      records_updated: 0,
      error_message: errorMessage,
    };
  }
}

/**
 * 측정사업장.xls 파일을 동기화
 */
export async function syncMeasurementBusiness(filePath?: string): Promise<SyncResult> {
  // .xlsx와 .xls 모두 지원
  const fileNameXlsx = "측정사업장.xlsx";
  const fileNameXls = "측정사업장.xls";
  const defaultPathXlsx = join(process.cwd(), fileNameXlsx);
  const defaultPathXls = join(process.cwd(), fileNameXls);

  const syncStartTime = new Date();
  let logId: number | null = null;
  let fileName = fileNameXlsx; // catch 블록에서 사용할 수 있도록 함수 상단에서 선언

  try {
    const supabase = await createClient();

    // 파일 소스 결정: Storage 우선, 로컬 파일 fallback
    let targetPath: string | Buffer | undefined = filePath;
    let fileBuffer: Buffer | undefined;
    let storageFileName: string | undefined;

    if (!targetPath) {
      // Storage에서 최신 파일 가져오기 시도
      const storageFile = await getLatestFileFromStorage("measurement-business");
      if (storageFile) {
        fileBuffer = storageFile.buffer;
        storageFileName = storageFile.fileName;
        fileName = storageFile.fileName;
        targetPath = fileBuffer;
      } else {
        // Storage에 파일이 없으면 로컬 파일 사용
        if (existsSync(defaultPathXlsx)) {
          targetPath = defaultPathXlsx;
          fileName = fileNameXlsx;
        } else if (existsSync(defaultPathXls)) {
          targetPath = defaultPathXls;
          fileName = fileNameXls;
        } else {
          throw new Error(`Excel 파일을 찾을 수 없습니다: ${fileNameXlsx} 또는 ${fileNameXls}`);
        }
      }
    } else {
      // filePath가 지정된 경우 (로컬 파일 경로)
      if (typeof targetPath === "string") {
        fileName = targetPath.includes(".xlsx") ? fileNameXlsx : fileNameXls;
        if (!existsSync(targetPath)) {
          throw new Error(`Excel 파일을 찾을 수 없습니다: ${targetPath}`);
        }
      } else {
        throw new Error("파일 경로가 올바르지 않습니다.");
      }
    }

    // 동기화 로그 시작
    const { data: logData, error: logError } = await supabase
      .from("sync_log")
      .insert({
        file_name: fileName,
        sync_type: "측정사업장",
        sync_start_time: syncStartTime.toISOString(),
        status: "진행중",
        records_processed: 0,
        records_updated: 0,
        records_inserted: 0,
      })
      .select("id")
      .single();

    if (logError) {
      console.error("동기화 로그 생성 실패:", logError);
    } else {
      logId = logData.id;
    }

    // Excel 파일 읽기
    let excelData: any[];
    let worksheet: XLSX.WorkSheet | undefined;
    let headerRowIndex: number | undefined;

    const readResult = fileBuffer
      ? readExcelFile(fileBuffer, storageFileName)
      : readExcelFile(targetPath as string);

    // readExcelFile의 반환값이 객체인 경우 (측정사업장 파일)
    if (readResult && typeof readResult === "object" && "data" in readResult) {
      excelData = readResult.data;
      worksheet = readResult.worksheet;
      headerRowIndex = readResult.headerRowIndex;
    } else {
      excelData = readResult as any[];
    }

    console.log(`[측정사업장 동기화] Excel 파일에서 읽은 데이터 행 수: ${excelData.length}`);

    // 디버깅: 첫 번째 행에서 컬럼 확인
    if (excelData.length > 0) {
      const firstRow = excelData[0];
      const keys = Object.keys(firstRow);
      console.log(`[측정사업장 동기화] 첫 번째 행의 컬럼 수: ${keys.length}`);
      console.log("[측정사업장 동기화] 첫 번째 행의 컬럼명 샘플 (최대 30개):", keys.slice(0, 30));

      // "코드" 컬럼 정확한 이름 찾기
      const codeColumnExact = keys.find(k => k === "코드");
      const codeColumnContains = keys.filter(k => k && k.includes("코드"));
      console.log(`[측정사업장 동기화] "코드" 컬럼 (정확히 일치): ${codeColumnExact || "없음"}`);
      console.log(`[측정사업장 동기화] "코드"를 포함하는 컬럼:`, codeColumnContains);

      // 코드 컬럼 값 샘플 확인
      if (codeColumnExact) {
        console.log(`[측정사업장 동기화] "코드" 컬럼 첫 5개 값:`,
          excelData.slice(0, 5).map((r: any) => r["코드"]));
        console.log(`[측정사업장 동기화] "코드" 컬럼 마지막 5개 값:`,
          excelData.slice(-5).map((r: any) => r["코드"]));
      }

      // "코드" 컬럼에서 H0432 찾기 (전체 데이터 검색)
      let h0432Found = false;
      let h0432RowIndex = -1;
      if (codeColumnExact) {
        for (let i = 0; i < excelData.length; i++) {
          const row = excelData[i];
          const codeValue = row["코드"];
          if (codeValue) {
            const codeStr = String(codeValue).trim();
            // 정확히 일치하거나 포함되는지 확인
            if (codeStr === "H0432" || codeStr.toUpperCase().includes("H0432")) {
              console.log(`[측정사업장 동기화] H0432 발견! 행 인덱스 ${i}, 코드 값: "${codeStr}"`);
              console.log(`[측정사업장 동기화] 해당 행의 주요 값:`, {
                "코드": row["코드"],
                "년도": row["년도"],
                "구분": row["구분"],
                "사업장명": row["사업장명"]
              });
              h0432Found = true;
              h0432RowIndex = i;
              break;
            }
          }
        }

        // H0432를 찾지 못했으면, "코드" 컬럼의 모든 고유 값 중 일부 확인
        if (!h0432Found) {
          console.warn("[측정사업장 동기화] 경고: '코드' 컬럼에서 H0432를 찾을 수 없습니다!");
          // 코드 컬럼의 고유 값 샘플 (H로 시작하는 코드들)
          const hCodes = new Set<string>();
          for (let i = 0; i < excelData.length; i++) {
            const code = String(excelData[i]["코드"] || "").trim();
            if (code.startsWith("H") && hCodes.size < 100) {
              hCodes.add(code);
            }
          }
          console.log(`[측정사업장 동기화] '코드' 컬럼의 H로 시작하는 코드 샘플 (최대 100개):`, Array.from(hCodes).sort().slice(0, 50));
        }
      } else {
        console.warn("[측정사업장 동기화] 경고: '코드' 컬럼을 찾을 수 없어 H0432 검색을 수행할 수 없습니다!");
      }

      // "향후측정주기" 관련 컬럼 찾기
      const periodColumns = keys.filter(k => k && (k.includes("향후") || (k.includes("주기") && k.includes("측정"))));
      if (periodColumns.length > 0) {
        console.log("[측정사업장 동기화] 향후측정주기 관련 컬럼:", periodColumns);
      }

      // BK 열 관련 디버깅: 모든 빈 헤더 확인
      const emptyHeaders = keys.filter(k => k.startsWith("__EMPTY_"));
      if (emptyHeaders.length > 0) {
        console.log(`[측정사업장 동기화] 빈 헤더(__EMPTY_XX) 개수: ${emptyHeaders.length}`);
        // BK 열 근처(61, 62, 63) 확인
        const bkRelatedEmptyHeaders = emptyHeaders.filter(key => {
          const match = key.match(/__EMPTY_(\d+)/);
          if (match) {
            const index = parseInt(match[1], 10);
            return index >= 60 && index <= 65; // BK 열 근처 (대략 62번째)
          }
          return false;
        });
        if (bkRelatedEmptyHeaders.length > 0) {
          console.log("[측정사업장 동기화] BK 열 근처(60-65) 빈 헤더:", bkRelatedEmptyHeaders);
          bkRelatedEmptyHeaders.forEach(key => {
            const value = firstRow[key];
            console.log(`[측정사업장 동기화]   ${key}: ${value} (타입: ${typeof value})`);
          });
        }
      }
    } else {
      console.error("[측정사업장 동기화] Excel 파일에서 데이터를 읽을 수 없습니다!");
    }

    const parsedData = parseMeasurementBusiness(excelData, worksheet, headerRowIndex, storageFileName || fileName);

    // 디버깅: H0432 데이터가 파싱되었는지 확인
    const h0432Parsed = parsedData.filter((row: any) => row.code && (row.code.toUpperCase().includes("H0432") || row.code.toUpperCase().includes("H432")));
    console.log(`[측정사업장 동기화] 파싱된 데이터 중 H0432 포함: ${h0432Parsed.length}건`);
    if (h0432Parsed.length > 0) {
      console.log("[측정사업장 동기화] H0432 파싱된 데이터:", h0432Parsed.map((r: any) => ({
        code: r.code,
        year: r.year,
        period: r.period,
        business_name: r.business_name
      })));
    } else {
      console.warn("[측정사업장 동기화] 경고: 파싱된 데이터에 H0432가 없습니다!");
    }

    // 디버깅: 파싱된 데이터 중 future_measurement_period가 있는 항목 확인
    const withPeriod = parsedData.filter((row: any) => row.future_measurement_period);
    console.log(`[측정사업장 동기화] future_measurement_period가 있는 항목 수: ${withPeriod.length} / 전체: ${parsedData.length}`);
    if (withPeriod.length > 0) {
      console.log("[측정사업장 동기화] future_measurement_period 샘플:", withPeriod.slice(0, 3).map((r: any) => ({
        code: r.code,
        year: r.year,
        period: r.period,
        future_measurement_period: r.future_measurement_period
      })));
    }

    let recordsProcessed = 0;

    // 데이터 준비
    const baseFields = [
      "code", "year", "period", "business_name", "business_number",
      "total_employees", "address", "office_jurisdiction",
      "measurement_start_date", "measurement_end_date",
      "completion_status", "measurer",
      "measurement_date", "future_measurement_date",
      "business_category"
    ];

    const optionalFields = [
      "manager_name", "manager_position", "manager_mobile",
      "manager_email", "invoice_email", "industrial_accident_number",
      "representative_name", "future_measurement_period"
    ];

    // UPSERT를 위해 모든 데이터 준비
    // NULL 값은 제외하고, 값이 있는 필드만 포함
    const allRows = parsedData
      .filter(row => row.code && row.year && row.period)
      .map(row => {
        const fullRow: any = {};

        // 필수 필드는 항상 포함 (code, year, period, business_name)
        fullRow.code = row.code;
        fullRow.year = row.year;
        fullRow.period = row.period;
        fullRow.business_name = row.business_name;

        // 나머지 baseFields는 값이 있는 경우만 포함
        const otherBaseFields = baseFields.filter(f => !["code", "year", "period", "business_name"].includes(f));
        otherBaseFields.forEach(field => {
          if (row[field] !== undefined && row[field] !== null && row[field] !== "") {
            fullRow[field] = row[field];
          }
        });

        // optionalFields는 값이 있는 경우만 포함하되, 
        // manager_mobile 등 일부 필드는 잘못된 데이터를 덮어쓰기 위해 null이나 빈 값이라도 포함시킬 수 있음
        optionalFields.forEach(field => {
          const value = row[field];
          // manager_mobile은 강제로 포함 (잘못된 데이터 클렌징을 위해)
          if (field === "manager_mobile") {
            fullRow[field] = value || null;
          }
          // 다른 필드는 값이 있는 경우만 포함
          else if (value !== undefined && value !== null && value !== "") {
            fullRow[field] = value;
          }
        });

        return fullRow;
      });

    // UPSERT 배치 처리 (1000개씩)
    if (allRows.length > 0) {
      const upsertBatchSize = 100;
      for (let i = 0; i < allRows.length; i += upsertBatchSize) {
        const batch = allRows.slice(i, i + upsertBatchSize);

        // UPSERT: ON CONFLICT (code, year, period) DO UPDATE
        const { error: upsertError } = await supabase
          .from("measurement_business")
          .upsert(batch, {
            onConflict: "code,year,period",
            ignoreDuplicates: false
          });

        if (upsertError) {
          // 배치 실패 시 개별 처리 (Fallback)
          console.warn(`배치 UPSERT 실패. 개별 처리로 전환합니다. (에러: ${upsertError.message})`);

          let successCountInBatch = 0;
          let failCountInBatch = 0;

          for (const row of batch) {
            try {
              const { error: singleError } = await supabase
                .from("measurement_business")
                .upsert(row, {
                  onConflict: "code,year,period",
                  ignoreDuplicates: false
                });

              if (singleError) {
                console.error(`개별 UPSERT 실패 (Code: ${row.code}):`, singleError.message);
                failCountInBatch++;
              } else {
                successCountInBatch++;
                recordsProcessed++;
              }
            } catch (e) {
              console.error(`개별 처리 중 예외 발생:`, e);
              failCountInBatch++;
            }
          }
          console.log(`배치 개별 처리 완료: 성공 ${successCountInBatch}건, 실패 ${failCountInBatch}건`);
        } else {
          recordsProcessed += batch.length;

          // H0432가 포함된 배치인지 확인 (성공 로그)
          const hasH0432 = batch.some(row => row.code === 'H0432');
          if (hasH0432) {
            const h0432Row = batch.find(row => row.code === 'H0432');
            console.log(`[성공] H0432 데이터 UPSERT 완료:`, {
              code: h0432Row?.code,
              year: h0432Row?.year,
              period: h0432Row?.period,
              business_name: h0432Row?.business_name
            });
          }
        }
      }
    }

    const syncEndTime = new Date();

    // measurement_target_business 테이블에도 동기화 (UI에 바로 반영되도록)
    // measurement_target_business는 "측정 대상 사업장 계획" 테이블로, 화면에 표시되는 데이터임
    if (allRows.length > 0) {
      try {
        // measurement_target_business 테이블에 맞는 필드만 추출
        const targetBusinessFields = [
          "code", "year", "period", "business_name", "business_number",
          "total_employees", "address", "office_jurisdiction", "designated_office",
          "measurement_start_date", "measurement_end_date", "completion_status", "measurer",
          "future_measurement_date", "measurement_date", "future_measurement_period",
          "manager_name", "manager_mobile", "manager_phone", "notes", "business_category"
        ];

        const targetRows = allRows.map(row => {
          const targetRow: any = {};
          targetBusinessFields.forEach(field => {
            if (row[field] !== undefined) {
              targetRow[field] = row[field];
            }
          });
          // is_registered 필드는 기본값 false
          targetRow.is_registered = false;

          // 필수 데이터인 plan_based_year, plan_based_period 추가 (v4 마이그레이션 대응)
          if (row.year) targetRow.plan_based_year = row.year;
          if (row.period) targetRow.plan_based_period = row.period;

          return targetRow;
        });

        // UPSERT 배치 처리 (1000개씩)
        const targetBatchSize = 1000;
        for (let i = 0; i < targetRows.length; i += targetBatchSize) {
          const batch = targetRows.slice(i, i + targetBatchSize);

          const { error: targetUpsertError } = await supabase
            .from("measurement_target_business")
            .upsert(batch, {
              onConflict: "code,year,period",
              ignoreDuplicates: false
            });

          if (targetUpsertError) {
            console.warn(`[측정사업장 동기화] measurement_target_business UPSERT 경고 (${i}~${i + batch.length}):`, targetUpsertError);
            // measurement_target_business 동기화 실패는 경고로만 처리하고 계속 진행
          }
        }

        console.log(`[측정사업장 동기화] measurement_target_business 테이블에도 ${targetRows.length}건 동기화 완료`);
      } catch (targetError) {
        console.warn("[측정사업장 동기화] measurement_target_business 동기화 경고:", targetError);
        // 실패해도 전체 동기화는 성공으로 처리 (measurement_business는 이미 성공)
      }
    }

    // 동기화 로그 업데이트
    if (logId) {
      await supabase
        .from("sync_log")
        .update({
          sync_end_time: syncEndTime.toISOString(),
          status: "성공",
          records_processed: parsedData.length,
          records_updated: recordsProcessed, // UPSERT는 INSERT와 UPDATE를 모두 포함
          records_inserted: recordsProcessed,
        })
        .eq("id", logId);
    }

    return {
      success: true,
      file_name: fileName,
      records_processed: parsedData.length,
      records_inserted: recordsProcessed, // UPSERT는 INSERT와 UPDATE를 모두 포함
      records_updated: recordsProcessed,
    };
  } catch (error) {
    const syncEndTime = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 상세 에러 로깅
    console.error("[측정사업장 동기화] 동기화 중 오류 발생:", {
      error,
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      fileName
    });

    // 동기화 로그 업데이트 (실패)
    if (logId) {
      try {
        const supabase = await createClient();
        await supabase
          .from("sync_log")
          .update({
            sync_end_time: syncEndTime.toISOString(),
            status: "실패",
            error_message: errorMessage,
          })
          .eq("id", logId);
      } catch (logError) {
        console.error("[측정사업장 동기화] 동기화 로그 업데이트 실패:", logError);
      }
    }

    return {
      success: false,
      file_name: fileName,
      records_processed: 0,
      records_inserted: 0,
      records_updated: 0,
      error_message: errorMessage,
    };
  }
}

/**
 * 모든 Excel 파일을 동기화
 */
export async function syncAllFiles(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  // 사업장정보.xls 동기화
  const businessInfoResult = await syncBusinessInfo();
  results.push(businessInfoResult);

  // 측정사업장.xls 동기화
  const measurementBusinessResult = await syncMeasurementBusiness();
  results.push(measurementBusinessResult);

  return results;
}

