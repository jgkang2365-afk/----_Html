import * as XLSX from 'xlsx';
import * as fs from 'fs';
import path from 'path';

async function main() {
    // 1. Read the existing report from the previous conversation directory
    const reportPath = 'C:/Users/USER/.gemini/antigravity/brain/79f0fbc1-47d3-4da9-891f-2e79853531bd/sequence_changes_report.md';
    if (!fs.existsSync(reportPath)) {
        console.error('Report file not found at:', reportPath);
        return;
    }

    const content = fs.readFileSync(reportPath, 'utf8');
    const lines = content.split('\n');

    const data: any[] = [];
    let currentOffice = '';

    lines.forEach(line => {
        if (line.startsWith('## 📍')) {
            currentOffice = line.replace('## 📍', '').trim().split(' ')[0];
        } else if (line.startsWith('|') && !line.includes('업체명') && !line.includes(':---')) {
            const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
            if (parts.length >= 4) {
                // Formatting: | 업체명 | 총인원 | ❌ 수정 전 | ✅ 복구 완료 | 측정일 |
                // parts[0] is Company Name, parts[1] is Employees, parts[2] is Before, parts[3] is After, parts[4] is Date
                const before = parts[2].replace(/\*\*/g, '');
                const after = parts[3].replace(/\*\*/g, '');

                // Only include if actual change occurred (though the report only lists changes)
                data.push({
                    '지청': currentOffice,
                    '사업장명': parts[0].replace(/\*\*/g, ''),
                    '총인원': parts[1].replace(/\*\*/g, ''),
                    '보정 전 연번 (틀린것)': before,
                    '보정 후 연번 (맞는것)': after,
                    '측정일': (parts[4] || '').replace(/\*\*/g, '')
                });
            }
        }
    });

    // 2. Create Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    // Column widths
    const wscols = [
        { wch: 10 }, // 지청
        { wch: 40 }, // 사업장명
        { wch: 8 },  // 총인원
        { wch: 20 }, // 보정 전
        { wch: 20 }, // 보정 후
        { wch: 15 }  // 측정일
    ];
    ws['!cols'] = wscols;

    XLSX.utils.book_append_sheet(wb, ws, "연번 보정 내역");

    const outPath = '0228_Sequence_Correction_List.xlsx';
    XLSX.writeFile(wb, outPath);

    console.log(`Excel file created: ${outPath} with ${data.length} records.`);
}

main().catch(console.error);
