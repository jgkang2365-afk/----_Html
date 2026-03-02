const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

async function run() {
    try {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
        const log = fs.readFileSync('recovery_log.txt', 'utf8');
        const records = {};
        const ids = [];

        const lines = log.split('\n');
        let currentId = null;
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

        if (ids.length === 0) {
            console.error("No IDs found.");
            process.exit(1);
        }

        const { data, error } = await supabase.from('measurement_journal')
            .select('id, designated_office, business_name, measurement_start_date, measurement_end_date, five_plus_sequence, total_employees')
            .in('id', ids);

        if (error) {
            console.error("DB Error:", error);
            process.exit(1);
        }

        const exportData = data.map(d => ({
            office: d.designated_office.includes('천안') ? '천안' : (d.designated_office.includes('평택') ? '평택' : '대전'),
            name: d.business_name || '',
            employees: (d.total_employees || 0) + '명',
            bad: records[d.id] || '?',
            good: d.five_plus_sequence || '-',
            dates: d.measurement_start_date ? (d.measurement_start_date + (d.measurement_end_date && d.measurement_end_date !== d.measurement_start_date ? ' ~ ' + d.measurement_end_date : '')) : '-'
        }));

        fs.writeFileSync('final_report_data.json', JSON.stringify(exportData, null, 2), 'utf8');
        console.log("SUCCESS");
    } catch (err) {
        console.error("Script Error:", err);
        process.exit(1);
    }
}
run();
