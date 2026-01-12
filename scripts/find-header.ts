/**
 * AV 열 주변의 실제 헤더 위치 찾기
 */

import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const wb = XLSX.read(readFileSync("측정사업장.xlsx"), { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(ws["!ref"]!);

console.log("AV 열(47번째 열) 주변의 처음 5개 행 확인:");
for (let row = 0; row < Math.min(5, range.e.r + 1); row++) {
  const cell = XLSX.utils.encode_cell({ r: row, c: 47 });
  const value = ws[cell] ? String(ws[cell].v || "").trim() : "";
  console.log(`행 ${row + 1}: '${value}'`);
}

console.log("\n첫 번째 행에서 비어있지 않은 컬럼명 샘플 (최대 20개):");
const nonEmptyHeaders: Array<{ col: number; name: string; header: string }> = [];
for (let col = range.s.c; col <= Math.min(range.e.c, range.s.c + 50); col++) {
  const headerCell = XLSX.utils.encode_cell({ r: 0, c: col });
  const header = ws[headerCell] ? String(ws[headerCell].v || "").trim() : "";
  if (header) {
    const colName = XLSX.utils.encode_col(col);
    nonEmptyHeaders.push({ col, name: colName, header });
    if (nonEmptyHeaders.length >= 20) break;
  }
}
nonEmptyHeaders.forEach(({ col, name, header }) => {
  console.log(`열 ${col} (${name}): '${header}'`);
});
