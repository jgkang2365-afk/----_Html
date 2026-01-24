/**
 * 엑셀 파싱 테스트 스크립트
 * 수정된 로직이 실제로 데이터를 올바르게 파싱하는지 검증
 */

import * as XLSX from "xlsx";
import path from "path";

const filePath = path.join(process.cwd(), "측정대상사업장목록_업로드 양식_2026-01-23.xlsx");

console.log("=== 측정 대상 사업장 엑셀 파싱 테스트 ===\n");

// 엑셀 날짜 변환 함수
function excelDateToJSDate(excelDate: number): string {
  const excelEpoch = new Date(1899, 11, 30);
  const jsDate = new Date(excelEpoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
  const year = jsDate.getFullYear();
  const month = String(jsDate.getMonth() + 1).padStart(2, "0");
  const day = String(jsDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 날짜 파싱 함수
function parseDateValue(dateVal: any): string | null {
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
    // Excel 날짜 시리얼 넘버
    if (dateVal > 1 && dateVal < 100000) {
      return excelDateToJSDate(dateVal);
    }
    return null;
  }

  // 문자열 처리
  const dateStr = String(dateVal).trim();
  if (!dateStr) return null;

  const compactStr = dateStr.replace(/\s/g, "");

  // YYYYMMDD 형식 (문자열)
  if (/^\d{8}$/.test(compactStr)) {
    const year = compactStr.substring(0, 4);
    const month = compactStr.substring(4, 6);
    const day = compactStr.substring(6, 8);
    return `${year}-${month}-${day}`;
  }

  // YYYY-MM-DD 형식
  if (/^\d{4}-\d{2}-\d{2}$/.test(compactStr)) {
    return compactStr;
  }

  // YYYY.MM.DD 형식
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
}

// 향후측정주기 파싱 함수
function parsePeriod(periodValue: any): number | null {
  if (!periodValue) return null;

  const periodStr = String(periodValue).trim();

  // 헤더 텍스트는 건너뛰기
  if (periodStr === "향후측정주기" ||
    periodStr === "향후 측정주기" ||
    periodStr === "전회 측정 주기" ||
    periodStr === "전회측정주기") {
    return null;
  }

  if (typeof periodValue === "number") {
    return Math.round(periodValue);
  }

  // "1년", "6개월" 형식 파싱
  if (periodStr.includes("년")) {
    const years = parseFloat(periodStr.replace(/년/g, "").trim());
    if (!isNaN(years) && years > 0) {
      return Math.round(years * 12);
    }
  } else if (periodStr.includes("개월")) {
    const months = parseFloat(periodStr.replace(/개월/g, "").trim());
    if (!isNaN(months) && months > 0) {
      return Math.round(months);
    }
  } else {
    // 숫자만 있는 경우
    const parsedPeriod = parseInt(periodStr.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(parsedPeriod) && parsedPeriod > 0 && parsedPeriod <= 60) {
      return parsedPeriod;
    }
  }

  return null;
}

// 엑셀 파일 읽기
const workbook = XLSX.readFile(filePath, { cellDates: true });
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// 두 번째 행부터 읽기 (첫 번째 행은 헤더)
const range = worksheet["!ref"];
if (!range) {
  console.error("엑셀 범위를 찾을 수 없습니다.");
  process.exit(1);
}

const decodedRange = XLSX.utils.decode_range(range);
const newRange = {
  s: { r: 1, c: decodedRange.s.c },
  e: { r: decodedRange.e.r, c: decodedRange.e.c }
};
const newRangeStr = XLSX.utils.encode_range(newRange);

const data = XLSX.utils.sheet_to_json(worksheet, {
  defval: null,
  raw: false,
  range: newRangeStr
});

console.log(`총 ${data.length}개 행 읽음\n`);

// 첫 5개 행 상세 파싱 테스트
console.log("=== 첫 5개 행 파싱 테스트 ===\n");

for (let i = 0; i < Math.min(5, data.length); i++) {
  const row: any = data[i];
  const rowValues = Object.values(row);

  console.log(`--- 행 ${i + 1} ---`);
  console.log(`코드: ${row["코드"] || rowValues[2]}`);
  console.log(`측정년도: ${row["측정년도"] || rowValues[0]}`);
  console.log(`측정주기: ${row["측정주기"] || rowValues[1]}`);
  console.log(`사업장명: ${row["사업장명"] || rowValues[11]}`);

  // 날짜 파싱
  const previousDate = row["전회측정일"] || rowValues[5];
  const futureDate = row["금회예정일"] || rowValues[7];
  const confirmedDate = row["금회측정확정일"] || rowValues[9];

  console.log(`전회측정일 (원본): "${previousDate}"`);
  console.log(`전회측정일 (파싱): ${parseDateValue(previousDate)}`);

  console.log(`금회예정일 (원본): "${futureDate}"`);
  console.log(`금회예정일 (파싱): ${parseDateValue(futureDate)}`);

  console.log(`금회측정확정일 (원본): "${confirmedDate}"`);
  console.log(`금회측정확정일 (파싱): ${parseDateValue(confirmedDate)}`);

  // 향후측정주기 파싱
  const period = row["전회 측정 주기"] || rowValues[6];
  console.log(`전회 측정 주기 (원본): "${period}"`);
  console.log(`전회 측정 주기 (파싱): ${parsePeriod(period)}개월`);

  // 기타 필드
  console.log(`업종분류: ${row["업종분류"] || rowValues[10]}`);
  console.log(`주소: ${row["주소"] || rowValues[12]}`);
  console.log(`소재지 관할청: ${row["소재지 관할청"] || rowValues[13]}`);
  console.log(`담당자명: ${row["담당자명"] || rowValues[14]}`);
  console.log(`담당자 휴대폰: ${row["담당자 휴대폰"] || rowValues[15]}`);
  console.log(`회사전화번호: ${row["회사전화번호"] || rowValues[16]}`);
  console.log(`국고결과: ${row["국고결과"] || rowValues[3]}`);
  console.log(`계획담당자: ${row["계획담당자"] || row["주관담당자"] || rowValues[4]}`);
  console.log("");
}

// 통계 정보
console.log("\n=== 파싱 통계 ===");

let successCount = 0;
let missingCodeCount = 0;
let missingYearCount = 0;
let missingPeriodCount = 0;
let missingNameCount = 0;
let hasFutureDateCount = 0;
let hasPreviousDateCount = 0;
let hasPeriodCount = 0;

data.forEach((row: any) => {
  const rowValues = Object.values(row);
  const code = row["코드"] || rowValues[2];
  const year = row["측정년도"] || rowValues[0];
  const period = row["측정주기"] || rowValues[1];
  const name = row["사업장명"] || rowValues[11];

  if (!code) missingCodeCount++;
  if (!year) missingYearCount++;
  if (!period) missingPeriodCount++;
  if (!name) missingNameCount++;

  if (code && year && period && name) successCount++;

  const futureDate = row["금회예정일"] || rowValues[7];
  const previousDate = row["전회측정일"] || rowValues[5];
  const measurementPeriod = row["전회 측정 주기"] || rowValues[6];

  if (parseDateValue(futureDate)) hasFutureDateCount++;
  if (parseDateValue(previousDate)) hasPreviousDateCount++;
  if (parsePeriod(measurementPeriod)) hasPeriodCount++;
});

console.log(`전체 행 수: ${data.length}`);
console.log(`필수 필드 모두 있음: ${successCount} (${((successCount / data.length) * 100).toFixed(1)}%)`);
console.log(`코드 누락: ${missingCodeCount}`);
console.log(`년도 누락: ${missingYearCount}`);
console.log(`주기 누락: ${missingPeriodCount}`);
console.log(`사업장명 누락: ${missingNameCount}`);
console.log(`금회예정일 있음: ${hasFutureDateCount} (${((hasFutureDateCount / data.length) * 100).toFixed(1)}%)`);
console.log(`전회측정일 있음: ${hasPreviousDateCount} (${((hasPreviousDateCount / data.length) * 100).toFixed(1)}%)`);
console.log(`전회 측정 주기 있음: ${hasPeriodCount} (${((hasPeriodCount / data.length) * 100).toFixed(1)}%)`);
