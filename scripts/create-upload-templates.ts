import * as XLSX from "xlsx";
import * as path from "path";
import * as fs from "fs";

// 템플릿 저장 디렉터리 경로 확보
const targetDir = path.join(process.cwd(), "public/templates");
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const templatePath = path.join(targetDir, "national_support_template.xlsx");

// 건강디딤돌 업로드 양식 헤더 정의
const headers = [
  "사업장관리번호",
  "사업개시번호",
  "사업장명",
  "대표자",
  "주소(필수 값 아님)",
  "담당자",
  "휴대전화번호 (010 제외한 번호만 입력)",
  "신청 여부",
  "신청결과",
  "사업장코드"
];

// 예시 데이터 정의
const sampleData = [
  {
    "사업장관리번호": "44886009240",
    "사업개시번호": "00000000000",
    "사업장명": "아산현대서비스 주식회사",
    "대표자": "맹의석",
    "주소(필수 값 아님)": "충청남도 아산시 온천대로 1790-9 (남동)",
    "담당자": "황중현",
    "휴대전화번호 (010 제외한 번호만 입력)": "31272365",
    "신청 여부": "○",
    "신청결과": "대상",
    "사업장코드": "H0240"
  }
];

// 워크북 및 워크시트 생성
const wb = XLSX.utils.book_new();

// json_to_sheet를 사용하여 데이터를 쓰되 헤더 순서 지정
const ws = XLSX.utils.json_to_sheet(sampleData, { header: headers });

// 셀 너비 자동 조정
const wsCols = [
  { wch: 18 }, // 사업장관리번호
  { wch: 18 }, // 사업개시번호
  { wch: 25 }, // 사업장명
  { wch: 12 }, // 대표자
  { wch: 45 }, // 주소
  { wch: 12 }, // 담당자
  { wch: 30 }, // 휴대전화번호
  { wch: 10 }, // 신청 여부
  { wch: 10 }, // 신청결과
  { wch: 12 }  // 사업장코드
];
ws["!cols"] = wsCols;

// 시트 이름을 자동화 프로그램 매크로가 식별하는 '건강디딤돌신청data_DB'로 지정
XLSX.utils.book_append_sheet(wb, ws, "건강디딤돌신청data_DB");

// 파일 쓰기
XLSX.writeFile(wb, templatePath);

console.log(`✅ 건강디딤돌 업로드 양식 생성 완료: ${templatePath}`);
