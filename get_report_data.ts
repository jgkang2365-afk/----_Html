import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';
import 'dotenv/config';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function run() {
    const log = fs.readFileSync('recovery_log.txt', 'utf8');
    const records: Record<number, string> = {};
    const ids: number[] = [];

    const lines = log.split('\n');
    let currentId: number | null = null;
    for (const line of lines) {
        const idMatch = line.match(/\(ID:\s*(\d+)\)/);
        if (idMatch) {
            currentId = parseInt(idMatch[1], 10);
            ids.push(currentId);
        }
        if (currentId && (line.includes('현재 꼬인 번호:') || line.includes('瑗ъ씤 踰덊샇:'))) {
            const parts = line.split(':');
            if (parts.length > 1) {
                const num = parts[1].trim().match(/\d+/);
                if (num) {
                    records[currentId] = num[0];
                    currentId = null;
                }
            }
        }
    }

    const { data } = await supabase.from('measurement_journal')
        .select('id, designated_office, business_name, measurement_start_date, measurement_end_date, five_plus_sequence, total_employees')
        .in('id', ids);

    if (!data) return;

    const exportData = data.map(d => ({
        office: d.designated_office.includes('천안') ? '천안' : (d.designated_office.includes('평택') ? '평택' : '대전'),
        name: d.business_name || '',
        employees: (d.total_employees || 0) + '명',
        bad: records[d.id] || '?',
        good: d.five_plus_sequence || '-',
        dates: d.measurement_start_date ? (d.measurement_start_date + (d.measurement_end_date && d.measurement_end_date !== d.measurement_start_date ? ' ~ ' + d.measurement_end_date : '')) : '-'
    }));

    fs.writeFileSync('C:/Users/USER/Desktop/cursor/측정일지_html/final_report_data.json', JSON.stringify(exportData), 'utf8');
}
run();
