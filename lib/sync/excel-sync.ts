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
 */
function readExcelFile(filePathOrBuffer: string | Buffer, fileName?: string): any[] {
  try {
    // 파일 경로 또는 Buffer에서 파일 버퍼 가져오기
    const fileBuffer = typeof filePathOrBuffer === "string" 
      ? readFileSync(filePathOrBuffer)
      : filePathOrBuffer;
    
    const filePathForCheck = typeof filePathOrBuffer === "string" 
      ? filePathOrBuffer 
      : (fileName || "");
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
    
    if (!firstRowHasData && filePathForCheck.includes("측정사업장")) {
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
      return data;
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

function parseMeasurementBusiness(data: any[]): any[] {
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
  }
  
  return data.map((row: any) => {
    // 코드 값 찾기 - 정확히 일치하는 컬럼 우선
    const codeValue = findColumnValue(row, ["코드", "코 드", "Code", "code", "CODE"]);
    
    // 실제 Excel 파일의 컬럼명에 맞게 매핑
    const period = row["구분"] || "";
    const normalizedPeriod = period.toString().includes("상반기") || period.toString().includes("상") ? "상반기" : 
                            period.toString().includes("하반기") || period.toString().includes("하") ? "하반기" : 
                            period.toString().trim();

    const completionStatus = row["완료여부"] || "미완료";
    const normalizedStatus = completionStatus.toString().includes("완료") && !completionStatus.toString().includes("미완료") ? "완료" : "미완료";

    // 날짜 변환 (Excel 날짜 또는 문자열 형식)
    let startDate = null;
    let endDate = null;
    
    const startDateStr = row["측정시작일"];
    const endDateStr = row["측정종료일"];
    
    if (startDateStr) {
      if (typeof startDateStr === "number") {
        // Excel 날짜 숫자 형식
        startDate = excelDateToJSDate(startDateStr);
      } else {
        // 문자열 형식 (YYYY-MM-DD 또는 YYYYMMDD)
        const dateStr = String(startDateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          // YYYY-MM-DD 형식
          startDate = dateStr;
        } else if (/^\d{8}$/.test(dateStr)) {
          // YYYYMMDD 형식 (예: 20260114)
          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(4, 6);
          const day = dateStr.substring(6, 8);
          startDate = `${year}-${month}-${day}`;
        } else if (dateStr) {
          // 다른 형식이면 null로 설정 (잘못된 형식)
          startDate = null;
        }
      }
    }
    
    if (endDateStr) {
      if (typeof endDateStr === "number") {
        endDate = excelDateToJSDate(endDateStr);
      } else {
        const dateStr = String(endDateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          // YYYY-MM-DD 형식
          endDate = dateStr;
        } else if (/^\d{8}$/.test(dateStr)) {
          // YYYYMMDD 형식 (예: 20260114)
          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(4, 6);
          const day = dateStr.substring(6, 8);
          endDate = `${year}-${month}-${day}`;
        } else if (dateStr) {
          // 다른 형식이면 null로 설정 (잘못된 형식)
          endDate = null;
        }
      }
    }

    // 기본 필드만 먼저 구성 (마이그레이션이 실행되지 않은 경우를 대비)
    const baseData: any = {
      code: String(codeValue || "").trim(),
      year: parseInt(row["년도"] || "0", 10),
      period: normalizedPeriod,
      business_name: String(row["사업장명"] || "").trim(),
      business_number: row["사업자번호"] || null,
      total_employees: row["총인원"] ? parseInt(String(row["총인원"]), 10) : null,
      address: row["주소"] || null,
      office_jurisdiction: row["관할청명"] || null,
      measurement_start_date: startDate || null,
      measurement_end_date: endDate || null,
      completion_status: normalizedStatus,
      measurer: row["측정자(담당)"] || row["측정자"] || row["담당"] || null,
    };

    // 담당자 정보 및 기타 정보는 마이그레이션 후에만 추가
    // 마이그레이션이 실행되지 않은 경우를 대비하여 조건부로 추가
    const optionalFields: any = {};
    
    // 담당자 정보 (여러 가능한 컬럼명 시도)
    const managerName = row["담당자"] || row["담당자명"] || row["담당자 성명"] || null;
    const managerPosition = row["직위"] || row["담당자 직위"] || null;
    const managerMobile = row["BK"] || row["BK열"] || row["담당자전화"] || row["담당자 휴대폰"] || row["휴대폰"] || null;
    const managerEmail = row["Email"] || row["이메일"] || row["담당자 e-mail"] || row["담당자 email"] || row["담당자이메일"] || null;
    const invoiceEmail = row["세금 Email"] || row["세금이메일"] || row["세금 Email"] || row["계산서 메일"] || row["계산서메일"] || null;
    const industrialAccidentNumber = row["산재관리번호"] || row["산재관리 번호"] || null;
    const representativeName = row["대표자명"] || row["대표자"] || null;

    // 값이 있는 경우에만 추가 (마이그레이션 후 컬럼이 있으면 저장됨)
    if (managerName) optionalFields.manager_name = managerName;
    if (managerPosition) optionalFields.manager_position = managerPosition;
    if (managerMobile) optionalFields.manager_mobile = managerMobile;
    if (managerEmail) optionalFields.manager_email = managerEmail;
    if (invoiceEmail) optionalFields.invoice_email = invoiceEmail;
    if (industrialAccidentNumber) optionalFields.industrial_accident_number = industrialAccidentNumber;
    if (representativeName) optionalFields.representative_name = representativeName;
    
    // 향후측정주기 (개월 단위, 예: 6, 12)
    // 여러 가능한 컬럼명 시도 (공백, 띄어쓰기 변형 포함)
    // 헤더가 비어있는 경우 __EMPTY_XX 형식으로 처리됨
    // 실제 Excel 파일에서 AV 열 근처의 헤더가 비어있는 컬럼이 __EMPTY_45로 매핑됨
    const futurePeriodValue = row["향후측정주기"] || row["향후 측정주기"] || row["향후측정 주기"] || 
                               row["향후측정기간"] || row["향후 측정기간"] || row["측정주기"] ||
                               row["재측정주기"] || row["재측정 주기"] || row["다음측정주기"] ||
                               row["향후측정기"] || row["향후 측정기"] ||
                               row["__EMPTY_45"]; // 실제 Excel 파일에서 이 키에 "향후측정주기" 데이터가 있음
    
    if (futurePeriodValue) {
      const periodValue = futurePeriodValue;
      const periodStr = String(periodValue).trim();
      
      // 헤더 텍스트인 "향후측정주기"는 건너뛰기
      if (periodStr === "향후측정주기" || periodStr === "향후 측정주기") {
        // 헤더 텍스트이므로 건너뛰기 - optionalFields에 추가하지 않음
      } else if (typeof periodValue === "number") {
        optionalFields.future_measurement_period = Math.round(periodValue);
      } else {
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

    return { ...baseData, ...optionalFields };
  }).filter((row) => row.code && row.year && row.period && row.business_name); // 필수 필드 체크
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
    if (fileBuffer) {
      excelData = readExcelFile(fileBuffer, storageFileName);
    } else {
      excelData = readExcelFile(targetPath as string);
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
    let excelData: any[];
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
    if (fileBuffer) {
      excelData = readExcelFile(fileBuffer, storageFileName);
    } else {
      excelData = readExcelFile(targetPath as string);
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
      }
      
      // 모든 데이터 행에서 H0432 찾기 (어떤 컬럼에 있는지 확인)
      let h0432Found = false;
      for (let i = 0; i < Math.min(excelData.length, 2000); i++) {
        const row = excelData[i];
        for (const key of keys) {
          const value = row[key];
          if (value && String(value).toUpperCase().includes("H0432")) {
            console.log(`[측정사업장 동기화] H0432 발견! 행 ${i}, 컬럼: "${key}", 값: "${value}"`);
            console.log(`[측정사업장 동기화] 해당 행의 다른 주요 값:`, {
              "년도": row["년도"],
              "구분": row["구분"],
              "사업장명": row["사업장명"],
              "코드": row["코드"]
            });
            h0432Found = true;
            break;
          }
        }
        if (h0432Found) break;
      }
      
      if (!h0432Found) {
        console.warn("[측정사업장 동기화] 경고: 전체 데이터에서 H0432를 찾을 수 없습니다!");
        // 마지막 20개 컬럼 확인 (뒤쪽에 코드가 있을 수 있음)
        console.log("[측정사업장 동기화] 마지막 20개 컬럼명:", keys.slice(-20));
      }
      
      // "향후측정주기" 관련 컬럼 찾기
      const periodColumns = keys.filter(k => k && (k.includes("향후") || (k.includes("주기") && k.includes("측정"))));
      if (periodColumns.length > 0) {
        console.log("[측정사업장 동기화] 향후측정주기 관련 컬럼:", periodColumns);
      }
    } else {
      console.error("[측정사업장 동기화] Excel 파일에서 데이터를 읽을 수 없습니다!");
    }
    
    const parsedData = parseMeasurementBusiness(excelData);
    
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
      "completion_status", "measurer"
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
        
        // optionalFields는 값이 있는 경우만 포함
        optionalFields.forEach(field => {
          if (row[field] !== undefined && row[field] !== null && row[field] !== "") {
            fullRow[field] = row[field];
          }
        });
        
        return fullRow;
      });

    // UPSERT 배치 처리 (1000개씩)
    if (allRows.length > 0) {
      const upsertBatchSize = 1000;
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
          // 마이그레이션이 실행되지 않은 경우, 기본 필드만 UPSERT 시도
          if (upsertError.message?.includes("column") && upsertError.message?.includes("schema cache")) {
            const basicBatch = batch.map(fullRow => {
              const baseRow: any = {};
              baseFields.forEach(field => {
                if (fullRow[field] !== undefined) {
                  baseRow[field] = fullRow[field];
                }
              });
              return baseRow;
            });
            
            const { error: basicUpsertError } = await supabase
              .from("measurement_business")
              .upsert(basicBatch, {
                onConflict: "code,year,period",
                ignoreDuplicates: false
              });
            
            if (basicUpsertError) {
              console.error(`배치 UPSERT 오류 (${i}~${i + batch.length}):`, basicUpsertError);
            } else {
              recordsProcessed += batch.length;
            }
          } else {
            console.error(`배치 UPSERT 오류 (${i}~${i + batch.length}):`, upsertError);
          }
        } else {
          recordsProcessed += batch.length;
        }
      }
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

