import * as XLSX from 'xlsx';
import * as fs from 'fs';
import path from 'path';
import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const filePath = path.join(process.cwd(), '0211_Backup_Comparison(수정완료).xlsx');
    const workbook = XLSX.readFile(filePath);
    const sheetName = '0227측정일 기준 연번 재검토 자료';
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const header = rows[0];
    const getIdx = (name: string) => header.findIndex(h => String(h || '').replace(/\s/g, '').includes(name.replace(/\s/g, '')));

    const idx = {
        code: getIdx('코드'),
        name: getIdx('사업장명'),
        date: getIdx('측정일'),
        seq: 6 // Column G
    };

    const { data: dbData } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, measurement_start_date, five_plus_sequence')
        .eq('measurement_year', 2026);

    if (!dbData) return;

    let markdownTable = '| 코드 | 사업장명 | 측정일 | 기존 연번 | 수정 연번 | 상태 |\n';
    markdownTable += '| :--- | :--- | :--- | :---: | :---: | :---: |\n';

    let changeCount = 0;

    rows.slice(1).forEach((row) => {
        const code = String(row[idx.code] || '').trim();
        const name = String(row[idx.name] || '').trim();
        const dateRaw = row[idx.date];
        const newSeq = row[idx.seq];
        if (!code || !name) return;

        let startDate = '';
        if (typeof dateRaw === 'string') startDate = dateRaw.split(' ~ ')[0].trim();
        else if (dateRaw instanceof Date) startDate = dateRaw.toISOString().split('T')[0];
        else if (typeof dateRaw === 'number') {
            const d = XLSX.SSF.parse_date_code(dateRaw);
            startDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        }

        const match = dbData.find(db =>
            String(db.code).trim() === code &&
            (String(db.business_name).trim() === name || String(db.business_name).replace(/\s/g, '') === name.replace(/\s/g, '')) &&
            (db.measurement_start_date === startDate || !startDate)
        );

        if (match) {
            const currentSeq = match.five_plus_sequence || '-';
            const status = String(currentSeq) !== String(newSeq) ? '🔄 변경' : '✅ 유지';
            if (String(currentSeq) !== String(newSeq)) changeCount++;
            markdownTable += `| ${code} | ${name} | ${startDate} | ${currentSeq} | **${newSeq}** | ${status} |\n`;
        }
    });

    const reportPath = path.join(process.cwd(), 'update_report.md');
    fs.writeFileSync(reportPath, markdownTable);
    console.log(`Generated report with ${changeCount} changes.`);
}

main().catch(console.error);
