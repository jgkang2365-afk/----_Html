/**
 * 첫 번째 행(헤더)의 모든 컬럼명 확인
 */

import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const wb = XLSX.read(readFileSync("측정사업장.xlsx"), { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(ws["!ref"]!);

console.log("첫 번째 행(헤더)의 모든 컬럼명:");
const headers: Array<{ col: number; name: string; header: string; data: string }> = [];
for (let col = range.s.c; col <= range.e.c; col++) {
  const headerCell = XLSX.utils.encode_cell({ r: 0, c: col });
  const header = ws[headerCell] ? String(ws[headerCell].v || "").trim() : "";
  const dataCell = XLSX.utils.encode_cell({ r: 1, c: col });
  const data = ws[dataCell] ? String(ws[dataCell].v || "").trim() : "";
  const colName = XLSX.utils.encode_col(col);
  if (header || data.includes("향후") || data.includes("주기")) {
    headers.push({ col, name: colName, header, data });
  }
}

console.log(`총 ${headers.length}개 컬럼 (비어있지 않거나 '향후/주기' 포함):`);
headers.forEach(({ col, name, header, data }) => {
  console.log(`열 ${col} (${name}): 헤더='${header}', 데이터='${data}'`);
});

// "향후측정주기"를 포함하는 헤더 찾기
console.log("\n'향후측정주기'를 포함하는 헤더:");
const periodHeaders = headers.filter(h => h.header.includes("향후") && h.header.includes("주기"));
if (periodHeaders.length > 0) {
  periodHeaders.forEach(h => console.log(`열 ${h.col} (${h.name}): ${h.header}`));
} else {
  console.log("찾을 수 없음");
}
