/**
 * 엑셀 파일 raw 셀 데이터 확인
 */

import * as XLSX from "xlsx";
import path from "path";

const filePath = path.join(process.cwd(), "측정대상사업장목록_업로드 양식_2026-01-23.xlsx");

console.log("=== 엑셀 파일 Raw 셀 데이터 확인 ===\n");

const workbook = XLSX.readFile(filePath, { cellDates: true });
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

console.log(`시트명: ${sheetName}`);
console.log(`범위: ${worksheet["!ref"]}\n`);

// 헤더 행 (row 0) 확인
console.log("=== 헤더 행 (Row 0) ===");
for (let col = 0; col < 20; col++) {
  const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
  const cell = worksheet[cellAddress];
  const colLetter = XLSX.utils.encode_col(col);
  if (cell) {
    console.log(`${colLetter} (${col}): "${cell.v}"`);
  } else {
    console.log(`${colLetter} (${col}): (empty)`);
  }
}

// 첫 3개 데이터 행 확인
for (let row = 1; row <= 3; row++) {
  console.log(`\n=== 데이터 행 ${row} ===`);
  for (let col = 0; col < 18; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = worksheet[cellAddress];
    const colLetter = XLSX.utils.encode_col(col);
    if (cell) {
      console.log(`${colLetter} (${col}): "${cell.v}"`);
    } else {
      console.log(`${colLetter} (${col}): (empty)`);
    }
  }
}
