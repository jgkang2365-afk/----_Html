/**
 * 과거 측정일지 및 매출정보 업로드용 Excel 양식 템플릿 생성 스크립트
 * 
 * 사용법:
 *   npx tsx scripts/create-upload-templates.ts
 */

import * as XLSX from "xlsx";
import { DESIGNATED_OFFICES } from "../lib/constants/designated-offices";
import { join } from "path";

// 측정일지 양식 생성
function createMeasurementJournalTemplate() {
  const workbook = XLSX.utils.book_new();

  // 시트 1: 측정일지 데이터
  const headers = [
    "코드*",
    "측정년도*",
    "측정주기*",
    "비고",
    "지정한계_관할지청*",
    "공문연번",
    "연번",
    "5인 이상 연번",
    "측정시작일",
    "측정종료일",
    "완료여부",
    "측정자",
    "소재지 관할청",
    "사업장명*",
    "총인원",
    "사업자번호",
    "산재보험번호",
    "대표자명",
    "국고지원여부",
    "주소",
    "전화번호",
    "팩스번호",
    "담당자명",
    "담당자직책",
    "담당자휴대폰",
    "담당자이메일",
    "K2B 전송일",
    "K2B 전송자",
    "계산서 이메일",
    "전자계산서 발행일",
    "측정비(합계)",
    "측정비(사업장)",
    "측정비(국고)",
    "입금액(합계)",
    "입금일(사업장)",
    "입금액(사업장)",
    "입금일(국고)",
    "입금액(국고)",
    "특이사항",
  ];

  // 예시 데이터 행
  const exampleRow = [
    "CODE001",
    2024,
    "상반기",
    "",
    DESIGNATED_OFFICES[0],
    "천-001",
    "001",
    "001",
    "2024-01-15",
    "2024-01-20",
    "완료",
    "홍길동",
    DESIGNATED_OFFICES[0],
    "예시 사업장",
    50,
    "123-45-67890",
    "1234567890",
    "홍길동",
    "지원",
    "충청남도 천안시 동남구",
    "041-123-4567",
    "041-123-4568",
    "김담당",
    "과장",
    "010-1234-5678",
    "manager@example.com",
    "2024-02-01",
    "홍길동",
    "invoice@example.com",
    "2024-02-15",
    1000000,
    700000,
    300000,
    1000000,
    "2024-02-20",
    700000,
    "2024-02-25",
    300000,
    "",
  ];

  const data = [headers, exampleRow];

  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // 열 너비 설정
  worksheet["!cols"] = [
    { wch: 10 }, // 코드
    { wch: 10 }, // 측정년도
    { wch: 10 }, // 측정주기
    { wch: 10 }, // 비고
    { wch: 25 }, // 지정한계_관할지청
    { wch: 12 }, // 공문연번
    { wch: 10 }, // 연번
    { wch: 12 }, // 5인 이상 연번
    { wch: 12 }, // 측정시작일
    { wch: 12 }, // 측정종료일
    { wch: 10 }, // 완료여부
    { wch: 15 }, // 측정자
    { wch: 25 }, // 소재지 관할청
    { wch: 25 }, // 사업장명
    { wch: 10 }, // 총인원
    { wch: 15 }, // 사업자번호
    { wch: 15 }, // 산재보험번호
    { wch: 15 }, // 대표자명
    { wch: 12 }, // 국고지원여부
    { wch: 30 }, // 주소
    { wch: 15 }, // 전화번호
    { wch: 15 }, // 팩스번호
    { wch: 15 }, // 담당자명
    { wch: 12 }, // 담당자직책
    { wch: 15 }, // 담당자휴대폰
    { wch: 25 }, // 담당자이메일
    { wch: 12 }, // K2B 전송일
    { wch: 15 }, // K2B 전송자
    { wch: 25 }, // 계산서 이메일
    { wch: 15 }, // 전자계산서 발행일
    { wch: 15 }, // 측정비(합계)
    { wch: 15 }, // 측정비(사업장)
    { wch: 15 }, // 측정비(국고)
    { wch: 15 }, // 입금액(합계)
    { wch: 12 }, // 입금일(사업장)
    { wch: 15 }, // 입금액(사업장)
    { wch: 12 }, // 입금일(국고)
    { wch: 15 }, // 입금액(국고)
    { wch: 30 }, // 특이사항
  ];

  // 헤더 행 스타일 (굵게)
  const headerCell = worksheet["A1"];
  if (headerCell) {
    headerCell.s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "366092" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, "측정일지");

  // 시트 2: 작성 가이드
  const guideData = [
    ["측정일지 업로드 양식 작성 가이드"],
    [""],
    ["※ 필수 항목은 * 표시가 되어 있습니다."],
    [""],
    ["1. 기본 정보"],
    ["  - 코드*: 측정사업장 코드 (필수)"],
    ["  - 측정년도*: 측정년도 (예: 2024)"],
    ["  - 측정주기*: 상반기 또는 하반기 (필수)"],
    [`  - 지정한계_관할지청*: ${DESIGNATED_OFFICES.join(", ")} 중 하나`],
    [""],
    ["2. 번호 정보"],
    ["  - 공문연번: 자동 부여되므로 비워두거나 기존 번호 입력"],
    ["  - 연번: 자동 부여되므로 비워두거나 기존 번호 입력"],
    ["  - 5인 이상 연번: 자동 부여되므로 비워두거나 기존 번호 입력"],
    [""],
    ["3. 날짜 형식"],
    ["  - 모든 날짜는 YYYY-MM-DD 형식으로 입력 (예: 2024-01-15)"],
    [""],
    ["4. 완료여부"],
    ["  - 완료 또는 미완료 중 하나 선택"],
    [""],
    ["5. 국고지원여부"],
    ["  - 지원 또는 비대상 중 하나 선택"],
    [""],
    ["6. 금액 형식"],
    ["  - 모든 금액은 숫자만 입력 (예: 1000000)"],
    ["  - 천단위 콤마는 입력하지 않습니다"],
    [""],
    ["7. 주의사항"],
    ["  - 예시 행은 삭제하고 실제 데이터만 입력하세요"],
    ["  - 코드는 measurement_business 테이블에 존재해야 합니다"],
    ["  - 공문연번은 중복될 수 없습니다"],
    ["  - 완료된 측정일지는 수정할 수 없습니다"],
  ];

  const guideSheet = XLSX.utils.aoa_to_sheet(guideData);
  guideSheet["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, guideSheet, "작성 가이드");

  const outputPath = join(process.cwd(), "측정일지_업로드양식.xlsx");
  XLSX.writeFile(workbook, outputPath);
  console.log(`✓ 측정일지 업로드 양식 생성 완료: ${outputPath}`);
}

// 기타 매출 양식 생성
function createOtherRevenueTemplate() {
  const workbook = XLSX.utils.book_new();

  // 시트 1: 기타 매출 데이터
  const headers = [
    "품명*",
    "매출년도",
    "매출주기",
    "공급가액",
    "부가세",
    "합계금액*",
    "계산서 e-mail",
    "계산서 발행일",
    "입금일",
    "입금액",
    "비고",
  ];

  // 예시 데이터 행
  const exampleRow = [
    "예시 품목",
    2024,
    "상반기",
    5000000,
    500000,
    5500000,
    "invoice@example.com",
    "2024-02-15",
    "2024-02-20",
    5500000,
    "",
  ];

  const data = [headers, exampleRow];

  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // 열 너비 설정
  worksheet["!cols"] = [
    { wch: 25 }, // 품명
    { wch: 12 }, // 매출년도
    { wch: 12 }, // 매출주기
    { wch: 15 }, // 공급가액
    { wch: 15 }, // 부가세
    { wch: 15 }, // 합계금액
    { wch: 30 }, // 계산서 e-mail
    { wch: 15 }, // 계산서 발행일
    { wch: 12 }, // 입금일
    { wch: 15 }, // 입금액
    { wch: 30 }, // 비고
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, "기타 매출");

  // 시트 2: 작성 가이드
  const guideData = [
    ["기타 매출 업로드 양식 작성 가이드"],
    [""],
    ["※ 필수 항목은 * 표시가 되어 있습니다."],
    [""],
    ["1. 기본 정보"],
    ["  - 품명*: 품목명 (필수)"],
    ["  - 매출년도: 매출 발생 연도 (예: 2024)"],
    ["  - 매출주기: 상반기 또는 하반기"],
    [""],
    ["2. 금액 정보"],
    ["  - 공급가액: 부가세 제외 금액"],
    ["  - 부가세: 부가세 금액"],
    ["  - 합계금액*: 공급가액 + 부가세 (필수, 자동 계산 가능)"],
    ["  - 모든 금액은 숫자만 입력 (예: 5000000)"],
    ["  - 천단위 콤마는 입력하지 않습니다"],
    [""],
    ["3. 날짜 형식"],
    ["  - 모든 날짜는 YYYY-MM-DD 형식으로 입력 (예: 2024-02-15)"],
    [""],
    ["4. 주의사항"],
    ["  - 예시 행은 삭제하고 실제 데이터만 입력하세요"],
    ["  - 합계금액은 공급가액 + 부가세와 일치해야 합니다"],
    ["  - 매출주기는 '상반기' 또는 '하반기'만 입력 가능합니다"],
  ];

  const guideSheet = XLSX.utils.aoa_to_sheet(guideData);
  guideSheet["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, guideSheet, "작성 가이드");

  const outputPath = join(process.cwd(), "기타매출_업로드양식.xlsx");
  XLSX.writeFile(workbook, outputPath);
  console.log(`✓ 기타 매출 업로드 양식 생성 완료: ${outputPath}`);
}

// 메인 실행
function main() {
  console.log("과거 데이터 업로드용 Excel 양식 생성 중...\n");
  
  try {
    createMeasurementJournalTemplate();
    createOtherRevenueTemplate();
    
    console.log("\n✓ 모든 양식 생성 완료!");
    console.log("\n생성된 파일:");
    console.log("  - 측정일지_업로드양식.xlsx");
    console.log("  - 기타매출_업로드양식.xlsx");
    console.log("\n사용 방법:");
    console.log("  1. 생성된 Excel 파일을 열어서 예시 행을 삭제하세요");
    console.log("  2. 실제 데이터를 입력하세요");
    console.log("  3. '작성 가이드' 시트를 참고하여 올바르게 작성하세요");
    console.log("  4. 작성 완료 후 업로드 기능을 통해 시스템에 반영하세요");
  } catch (error) {
    console.error("양식 생성 중 오류 발생:", error);
    process.exit(1);
  }
}

main();
