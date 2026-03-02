import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, five_plus_sequence, updated_at')
        .gt('updated_at', '2026-02-28T00:00:00+00:00')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }

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

    const reportPath = 'C:/Users/USER/.gemini/antigravity/brain/3ab2d261-5182-4672-ba9b-ad50944c9a1a/recent_updates_report.md';
    fs.writeFileSync(reportPath, md);
    console.log('Report generated at:', reportPath);
}
check();
