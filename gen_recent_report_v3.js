const { createClient } = require("@supabase/supabase-js");
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    try {
        const { data, error } = await supabase
            .from('measurement_journal')
            .select('id, code, business_name, five_plus_sequence, updated_at')
            .gt('updated_at', '2026-02-28T00:00:00+00:00')
            .order('updated_at', { ascending: false });

        if (error) throw error;

        let md = '## 2월 28일 이후 DB 업데이트 이력 실사\n\n';
        if (!data || data.length === 0) {
            md += '2월 28일 이후 현재까지 수정된 내역이 없습니다.\n';
        } else {
            md += '| 수정 시점 (KST) | 코드 | 사업장명 | 현재 연번 |\n';
            md += '| :--- | :--- | :--- | :---: |\n';
            data.forEach(item => {
                const date = new Date(item.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                md += `| ${date} | ${item.code} | ${item.business_name} | ${item.five_plus_sequence || '-'} |\n`;
            });
        }

        fs.writeFileSync('recent_report.md', md, 'utf8');
        console.log('Report saved to recent_report.md');
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}
check();
