import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';

// 파일 경로 설정 (현재 프로젝트 폴더 내 파일)
const filePath = path.join(process.cwd(), '측정대상사업장목록_업로드 양식_2026-01-23.xlsx');

console.log(`=== 엑셀 파일 구조 분석 ===`);
console.log(`파일 경로: ${filePath}`);

try {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ 파일을 찾을 수 없습니다! 경로를 확인해주세요.`);
        // 바탕화면의 다른 파일들도 검색해봅니다.
        const desktopPath = path.dirname(filePath);
        const files = fs.readdirSync(desktopPath).filter(f => f.includes('.xls'));
        console.log(`[참고] 바탕화면의 엑셀 파일 목록:`, files);
        process.exit(1);
    }

    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    console.log(`시트 이름: ${sheetName}`);

    const worksheet = workbook.Sheets[sheetName];

    // 헤더(1행) 읽기 (옵션: header: 1은 배열들의 배열로 반환)
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    if (jsonData.length === 0) {
        console.error("❌ 데이터가 없습니다.");
        process.exit(1);
    }

    console.log(`\n데이터 미리보기 (상위 3행):`);
    // 1행: 헤더일 가능성이 높음
    // 2행: 실제 데이터일 가능성이 높음
    for (let i = 0; i < Math.min(5, jsonData.length); i++) {
        console.log(`[Row ${i + 1}]`, jsonData[i]);
    }

    // 헤더로 추정되는 1행(index 0) 분석
    const headers = jsonData[0] as any[];
    console.log(`\n=== 감지된 헤더 목록 (${headers.length}개) ===`);
    headers.forEach((h, idx) => {
        console.log(`Column ${idx}: "${h}"`);
    });

} catch (error) {
    console.error("오류 발생:", error);
}
