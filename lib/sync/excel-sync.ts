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
 */
function readExcelFile(filePath: string): any[] {
  try {
    // 파일을 buffer로 읽어서 처리 (파일 잠금 문제 방지)
    const fileBuffer = readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { 
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellText: false
    });
    const sheetName = workbook.SheetNames[0]; // 첫 번째 시트 사용
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    return data;
  } catch (error) {
    throw new Error(`Excel 파일 읽기 실패: ${filePath} - ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 사업장정보.xls 파일을 파싱하여 business_info 테이블 형식으로 변환
 * 실제 Excel 파일의 컬럼명에 맞게 매핑을 조정해야 합니다.
 */
function parseBusinessInfo(data: any[]): any[] {
  return data.map((row: any) => {
    // 실제 Excel 파일의 컬럼명에 맞게 매핑
    return {
      code: String(row["코드"] || "").trim(),
      business_name: String(row["사업장명"] || "").trim(),
      business_number: row["사업자번호"] || null,
      address1: row["주소1"] || null,
      address2: row["주소2"] || null,
      phone: row["전화번호"] || null,
      fax: row["팩스번호"] || null,
      representative_name: row["대표자명"] || null,
    };
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

function parseMeasurementBusiness(data: any[]): any[] {
  return data.map((row: any) => {
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
        // 문자열 형식 (YYYY-MM-DD 또는 다른 형식)
        const dateStr = String(startDateStr).trim();
        // 이미 YYYY-MM-DD 형식이면 그대로 사용, 아니면 파싱 시도
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          startDate = dateStr;
        } else {
          // 다른 형식은 나중에 처리하거나 null로 설정
          startDate = dateStr || null;
        }
      }
    }
    
    if (endDateStr) {
      if (typeof endDateStr === "number") {
        endDate = excelDateToJSDate(endDateStr);
      } else {
        const dateStr = String(endDateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          endDate = dateStr;
        } else {
          endDate = dateStr || null;
        }
      }
    }

    // 기본 필드만 먼저 구성 (마이그레이션이 실행되지 않은 경우를 대비)
    const baseData: any = {
      code: String(row["코드"] || "").trim(),
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
  
  // 파일 경로가 지정되지 않은 경우, .xlsx를 우선 확인
  let targetPath = filePath;
  let fileName = fileNameXlsx;
  
  if (!targetPath) {
    if (existsSync(defaultPathXlsx)) {
      targetPath = defaultPathXlsx;
      fileName = fileNameXlsx;
    } else if (existsSync(defaultPathXls)) {
      targetPath = defaultPathXls;
      fileName = fileNameXls;
    } else {
      throw new Error(`Excel 파일을 찾을 수 없습니다: ${fileNameXlsx} 또는 ${fileNameXls}`);
    }
  } else {
    fileName = filePath.includes(".xlsx") ? fileNameXlsx : fileNameXls;
    if (!existsSync(targetPath)) {
      throw new Error(`Excel 파일을 찾을 수 없습니다: ${targetPath}`);
    }
  }

  const syncStartTime = new Date();
  let logId: number | null = null;

  try {
    const supabase = await createClient();

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
    const excelData = readExcelFile(targetPath);
    const parsedData = parseBusinessInfo(excelData);

    let recordsInserted = 0;
    let recordsUpdated = 0;

    // UPSERT 작업
    for (const row of parsedData) {
      const { data: existing, error: selectError } = await supabase
        .from("business_info")
        .select("code")
        .eq("code", row.code)
        .single();

      if (selectError && selectError.code !== "PGRST116") {
        // PGRST116은 "no rows returned" 에러이므로 무시
        console.error(`기존 데이터 조회 실패 (code: ${row.code}):`, selectError);
        continue;
      }

      if (existing) {
        // 업데이트
        const { error: updateError } = await supabase
          .from("business_info")
          .update(row)
          .eq("code", row.code);

        if (updateError) {
          console.error(`데이터 업데이트 실패 (code: ${row.code}):`, updateError);
        } else {
          recordsUpdated++;
        }
      } else {
        // 삽입
        const { error: insertError } = await supabase
          .from("business_info")
          .insert(row);

        if (insertError) {
          console.error(`데이터 삽입 실패 (code: ${row.code}):`, insertError);
        } else {
          recordsInserted++;
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
  
  // 파일 경로가 지정되지 않은 경우, .xlsx를 우선 확인
  let targetPath = filePath;
  let fileName = fileNameXlsx;
  
  if (!targetPath) {
    if (existsSync(defaultPathXlsx)) {
      targetPath = defaultPathXlsx;
      fileName = fileNameXlsx;
    } else if (existsSync(defaultPathXls)) {
      targetPath = defaultPathXls;
      fileName = fileNameXls;
    } else {
      throw new Error(`Excel 파일을 찾을 수 없습니다: ${fileNameXlsx} 또는 ${fileNameXls}`);
    }
  } else {
    fileName = filePath.includes(".xlsx") ? fileNameXlsx : fileNameXls;
    if (!existsSync(targetPath)) {
      throw new Error(`Excel 파일을 찾을 수 없습니다: ${targetPath}`);
    }
  }

  const syncStartTime = new Date();
  let logId: number | null = null;

  try {
    const supabase = await createClient();

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
    const excelData = readExcelFile(targetPath);
    const parsedData = parseMeasurementBusiness(excelData);

    let recordsInserted = 0;
    let recordsUpdated = 0;

    // UPSERT 작업
    // measurement_business는 (code, year, period) 조합이 유니크해야 함
    for (const row of parsedData) {
      const { data: existing, error: selectError } = await supabase
        .from("measurement_business")
        .select("code")
        .eq("code", row.code)
        .eq("year", row.year)
        .eq("period", row.period)
        .maybeSingle();

      if (selectError && selectError.code !== "PGRST116") {
        console.error(`기존 데이터 조회 실패 (code: ${row.code}, year: ${row.year}, period: ${row.period}):`, selectError);
        continue;
      }

      // 마이그레이션이 실행되지 않은 경우를 대비하여 기본 필드만 먼저 저장
      const baseFields = [
        "code", "year", "period", "business_name", "business_number", 
        "total_employees", "address", "office_jurisdiction", 
        "measurement_start_date", "measurement_end_date", 
        "completion_status", "measurer"
      ];
      
      const baseRow: any = {};
      baseFields.forEach(field => {
        if (row[field] !== undefined) {
          baseRow[field] = row[field];
        }
      });

      // 추가 필드들 (마이그레이션 후에만 저장)
      const optionalFields = [
        "manager_name", "manager_position", "manager_mobile", 
        "manager_email", "invoice_email", "industrial_accident_number", 
        "representative_name"
      ];
      
      const fullRow = { ...baseRow };
      optionalFields.forEach(field => {
        if (row[field] !== undefined && row[field] !== null) {
          fullRow[field] = row[field];
        }
      });

      if (existing) {
        // 업데이트 시도 (전체 필드 포함)
        let { error: updateError } = await supabase
          .from("measurement_business")
          .update(fullRow)
          .eq("code", row.code)
          .eq("year", row.year)
          .eq("period", row.period);

        // 마이그레이션이 안 된 경우 기본 필드만 업데이트
        if (updateError && updateError.message?.includes("column") && updateError.message?.includes("schema cache")) {
          console.warn(`마이그레이션이 실행되지 않아 기본 필드만 업데이트합니다 (code: ${row.code}):`, updateError.message);
          const { error: baseUpdateError } = await supabase
            .from("measurement_business")
            .update(baseRow)
            .eq("code", row.code)
            .eq("year", row.year)
            .eq("period", row.period);
          
          if (baseUpdateError) {
            console.error(`기본 필드 업데이트 실패 (code: ${row.code}):`, baseUpdateError);
          } else {
            recordsUpdated++;
          }
        } else if (updateError) {
          console.error(`데이터 업데이트 실패 (code: ${row.code}, year: ${row.year}, period: ${row.period}):`, updateError);
        } else {
          recordsUpdated++;
        }
      } else {
        // 삽입 시도 (전체 필드 포함)
        let { error: insertError } = await supabase
          .from("measurement_business")
          .insert(fullRow);

        // 마이그레이션이 안 된 경우 기본 필드만 삽입
        if (insertError && insertError.message?.includes("column") && insertError.message?.includes("schema cache")) {
          console.warn(`마이그레이션이 실행되지 않아 기본 필드만 삽입합니다 (code: ${row.code}):`, insertError.message);
          const { error: baseInsertError } = await supabase
            .from("measurement_business")
            .insert(baseRow);
          
          if (baseInsertError) {
            console.error(`기본 필드 삽입 실패 (code: ${row.code}):`, baseInsertError);
          } else {
            recordsInserted++;
          }
        } else if (insertError) {
          console.error(`데이터 삽입 실패 (code: ${row.code}, year: ${row.year}, period: ${row.period}):`, insertError);
        } else {
          recordsInserted++;
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

