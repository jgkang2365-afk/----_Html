import * as XLSX from 'xlsx';
import * as fs from 'fs';
import path from 'path';

async function main() {
    const jsonPath = path.join(process.cwd(), 'final_report_data.json');
    if (!fs.existsSync(jsonPath)) {
        console.error('Data file not found!');
        return;
    }

    const rawData = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(rawData);

    // 컬럼명 한글로 변경
    const excelData = data.map((item: any) => ({
        '소속': item.office,
        '사업장명': item.name,
        '총인원': item.employees,
        '기존 번호(버그)': item.bad,
        '복구 완료 번호(정상)': item.good,
        '측정일(생성일)': item.dates
    }));

    // 워크북 및 워크시트 생성
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // 열 너비 설정
    const wscols = [
        { wch: 10 }, // 소속
        { wch: 40 }, // 사업장명
        { wch: 10 }, // 총인원
        { wch: 15 }, // 기존 번호
        { wch: 20 }, // 복구 완료 번호
        { wch: 15 }  // 측정일
    ];
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, '복구결과_상세');

    const outPath = 'sequence_changes_report.xlsx';
    XLSX.writeFile(wb, outPath);

    console.log(`Excel report generated successfully: ${outPath}`);
}

main().catch(console.error);
