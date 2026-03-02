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
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        return;
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = '0227측정일 기준 연번 재검토 자료';
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
        console.error(`Sheet "${sheetName}" not found.`);
        return;
    }

    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (rows.length < 2) {
        console.error('No data rows found.');
        return;
    }

    const header = rows[0];
    console.log('Raw Header Row:', header);

    // Define column indices based on header positions
    const getIdx = (name: string) => header.findIndex(h => String(h || '').replace(/\s/g, '').includes(name.replace(/\s/g, '')));

    const idx = {
        code: getIdx('코드'),
        name: getIdx('사업장명'),
        date: getIdx('측정일'),
        seq: getIdx('5인이상연번') !== -1 ? getIdx('5인이상연번') : 6 // Default to G (index 6) if not found
    };

    console.log('Detected Indices:', idx);

    // Fetch all 2026 journals
    const { data: dbData, error } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, measurement_start_date, measurement_end_date, five_plus_sequence')
        .eq('measurement_year', 2026);

    if (error || !dbData) return;

    const updates: any[] = [];
    const missing: any[] = [];

    rows.slice(1).forEach((row, index) => {
        const code = String(row[idx.code] || '').trim();
        const name = String(row[idx.name] || '').trim();
        const dateRaw = row[idx.date];
        const newSeq = row[idx.seq];

        if (!code || !name) return; // Skip empty rows

        let startDate = '';
        if (typeof dateRaw === 'string') {
            startDate = dateRaw.split(' ~ ')[0].trim();
        } else if (dateRaw instanceof Date) {
            startDate = dateRaw.toISOString().split('T')[0];
        } else if (typeof dateRaw === 'number') {
            // Excel serial date handling if needed, but usually xlsx handles it as Date
            const d = XLSX.SSF.parse_date_code(dateRaw);
            startDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
        }

        // Find match in DB
        const match = dbData.find(db =>
            String(db.code).trim() === code &&
            (String(db.business_name).trim() === name ||
                String(db.business_name).replace(/\s/g, '') === name.replace(/\s/g, '')) &&
            (db.measurement_start_date === startDate || !startDate)
        );

        if (index < 5) {
            console.log(`Debug [Row ${index + 1}]: Excel(${code}, ${name}, ${startDate}) -> MatchFound: ${!!match}`);
        }

        if (match) {
            const currentSeq = match.five_plus_sequence;
            if (String(currentSeq) !== String(newSeq)) {
                updates.push({
                    id: match.id,
                    code: code,
                    name: name,
                    from: currentSeq,
                    to: newSeq
                });
            }
        } else {
            missing.push({ code, name, dateRange: String(dateRaw || '') });
        }
    });

    console.log('--- DB UPDATE SIMULATION ---');
    console.log(`Matching records found: ${rows.length - 1 - missing.length}`);
    console.log(`Records to be updated: ${updates.length}`);
    console.log(`Records not found in DB: ${missing.length}`);

    if (updates.length > 0) {
        console.log('\n[Planned Changes]');
        updates.forEach(u => {
            console.log(`- [${u.code}] ${u.name}: ${u.from} -> ${u.to}`);
        });
    }

    if (missing.length > 0) {
        console.log('\n[Manual Check Required - Not Found in DB]');
        missing.forEach(m => console.log(`- [${m.code}] ${m.name} (${m.dateRange})`));
    }

    console.log('\nSummary: If this looks correct, I will proceed with the actual update.');
}

main().catch(console.error);
