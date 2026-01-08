/**
 * Excel 파일의 컬럼명을 확인하는 스크립트
 * 실행: npx tsx scripts/check-excel-columns.ts
 */

import * as XLSX from "xlsx";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

function checkExcelColumns(filePath: string, fileName: string) {
  console.log(`\n=== ${fileName} ===`);
  
  if (!existsSync(filePath)) {
    console.error(`파일을 찾을 수 없습니다: ${filePath}`);
    return;
  }

  try {
    // 파일을 buffer로 읽어서 처리
    const fileBuffer = readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { 
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellText: false
    });
    const sheetName = workbook.SheetNames[0];
    console.log(`시트명: ${sheetName}`);
    
    const worksheet = workbook.Sheets[sheetName];
    
    // 첫 번째 행(헤더) 읽기
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:Z1");
    const headers: string[] = [];
    
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      const header = cell ? String(cell.v || "").trim() : "";
      if (header) {
        headers.push(header);
      }
    }
    
    console.log(`\n총 컬럼 수: ${headers.length}`);
    console.log("\n컬럼명 목록:");
    headers.forEach((header, index) => {
      console.log(`  ${index + 1}. ${header}`);
    });
    
    // 첫 번째 데이터 행 샘플 출력 (최대 5개 컬럼)
    console.log("\n첫 번째 데이터 행 샘플:");
    const firstDataRow: any = {};
    for (let col = range.s.c; col <= Math.min(range.e.c, range.s.c + 4); col++) {
      const headerAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      const dataAddress = XLSX.utils.encode_cell({ r: 1, c: col });
      const header = worksheet[headerAddress] ? String(worksheet[headerAddress].v || "").trim() : "";
      const data = worksheet[dataAddress] ? worksheet[dataAddress].v : null;
      if (header) {
        firstDataRow[header] = data;
        console.log(`  ${header}: ${data !== null && data !== undefined ? data : "(비어있음)"}`);
      }
    }
    
  } catch (error) {
    console.error(`오류 발생: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 실행
const projectRoot = process.cwd();

console.log("Excel 파일 컬럼명 확인");
console.log("=".repeat(50));

// .xlsx 파일 우선 확인
const businessInfoXlsx = join(projectRoot, "사업장정보.xlsx");
const businessInfoXls = join(projectRoot, "사업장정보.xls");
const measurementXlsx = join(projectRoot, "측정사업장.xlsx");
const measurementXls = join(projectRoot, "측정사업장.xls");

if (existsSync(businessInfoXlsx)) {
  checkExcelColumns(businessInfoXlsx, "사업장정보.xlsx");
} else if (existsSync(businessInfoXls)) {
  checkExcelColumns(businessInfoXls, "사업장정보.xls");
} else {
  console.error("\n사업장정보 파일을 찾을 수 없습니다.");
}

if (existsSync(measurementXlsx)) {
  checkExcelColumns(measurementXlsx, "측정사업장.xlsx");
} else if (existsSync(measurementXls)) {
  checkExcelColumns(measurementXls, "측정사업장.xls");
} else {
  console.error("\n측정사업장 파일을 찾을 수 없습니다.");
}

console.log("\n" + "=".repeat(50));
console.log("확인 완료");

