
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

// 템플릿 데이터 (헤더) - 사용자 요청 및 TRD/API 스펙 반영
// API 매핑: 
// 년도 -> year
// 주기 -> period
// 관리번호 -> code (m.i_code)
// 사업장명 -> business_name
// 소재지 -> address
// 업종 -> business_category
// 담당자 -> manager_name (업체 담당자)
// 연락처 -> manager_mobile (업체 담당자 휴대폰)
// 회사전화 -> phone
// 계획담당자 -> plan_manager (내부 담당자)
// 관할청 -> office_jurisdiction
// 실시여부 -> is_registered
// 측정예정월 -> measurement_month
// 측정확정일 -> measurement_confirmed_date
// 비고 -> notes

const headers = [
    "년도",
    "주기",
    "코드",          // 관리번호 -> 코드
    "사업장명",
    "소재지",
    "업종",
    "담당자",
    "연락처",
    "회사전화",
    "계획담당자",
    "관할청",
    "실시여부",
    "측정예정월",    // 추가
    "측정확정일",    // 추가
    "비고"
];

// 예시 데이터 (사용자 가이드용)
const exampleRow = [
    new Date().getFullYear(), // 년도
    "상반기", // 주기
    "H0001", // 코드 (필수)
    "(주)예시사업장", // 사업장명
    "서울시 구로구 디지털로", // 소재지
    "소프트웨어개발", // 업종
    "김담당", // 담당자
    "010-1234-5678", // 연락처
    "02-123-4567", // 회사전화
    "이주형", // 계획담당자
    "서울관악", // 관할청
    "미실시", // 실시여부
    "3월",   // 측정예정월
    "",      // 측정확정일 (YYYY-MM-DD)
    "특이사항 없음" // 비고
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);

// 컬럼 너비 설정
ws["!cols"] = [
    { wch: 8 },  // 년도
    { wch: 8 },  // 주기
    { wch: 12 }, // 관리번호
    { wch: 20 }, // 사업장명
    { wch: 40 }, // 소재지
    { wch: 15 }, // 업종
    { wch: 10 }, // 담당자
    { wch: 15 }, // 연락처
    { wch: 15 }, // 회사전화
    { wch: 10 }, // 계획담당자
    { wch: 10 }, // 관할청
    { wch: 10 }, // 실시여부
    { wch: 10 }, // 측정예정월
    { wch: 12 }, // 측정확정일
    { wch: 20 }  // 비고
];

XLSX.utils.book_append_sheet(wb, ws, "측정대상사업장");

// Public 폴더에 저장
const publicDir = path.join(process.cwd(), "public", "templates");
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

const filePath = path.join(publicDir, "measure_target_template.xlsx");
XLSX.writeFile(wb, filePath);

console.log(`템플릿 생성 완료: ${filePath}`);
