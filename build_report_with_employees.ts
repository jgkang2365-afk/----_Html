import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function toShortName(fullName: string) {
    if (!fullName) return "기타";
    if (fullName.includes("천안")) return "천안";
    if (fullName.includes("대전")) return "대전";
    if (fullName.includes("평택")) return "평택";
    if (fullName.includes("청주")) return "청주";
    if (fullName.includes("충주")) return "충주";
    if (fullName.includes("보령")) return "보령";
    if (fullName.includes("서산")) return "서산";
    return fullName;
}

function formatDateRange(start: string | null, end: string | null) {
    if (!start && !end) return "-";
    if (start === end) return start;
    return `${start || ''} ~ ${end || ''}`;
}

async function main() {
    let content = '';
    try {
        content = fs.readFileSync('recovery_log.txt', 'utf8');
    } catch (e) {
        // Handle potential encoding issues if raw read fails
        try {
            const buffer = fs.readFileSync('recovery_log.txt');
            content = buffer.toString('binary');
        } catch (e2) {
            console.error('Could not read recovery_log.txt');
            return;
        }
    }

    const records: Record<string, { id: number, bad: string }> = {};
    const ids: number[] = [];

    // Parse original IDs and bad sequence numbers
    const lines = content.split('\n');
    let currentId: number | null = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
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
                    records[currentId] = { id: currentId, bad: num[0] };
                    currentId = null;
                }
            }
        }
    }

    if (ids.length === 0) {
        console.log("No IDs found in log.");
        return;
    }

    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, designated_office, business_name, measurement_start_date, measurement_end_date, five_plus_sequence, total_employees')
        .in('id', ids);

    if (error || !data) {
        console.error('DB fetch failed', error);
        return;
    }

    const enriched = data.map(d => ({
        office: toShortName(d.designated_office),
        name: d.business_name || '',
        bad: records[d.id]?.bad || '?',
        good: d.five_plus_sequence || '-',
        employees: d.total_employees || 0,
        dates: formatDateRange(d.measurement_start_date, d.measurement_end_date)
    })).sort((a, b) => parseInt(a.good) - parseInt(b.good));

    const grouped: Record<string, typeof enriched> = { '천안': [], '평택': [], '대전': [] };
    enriched.forEach(item => {
        if (!grouped[item.office]) grouped[item.office] = [];
        grouped[item.office].push(item);
    });

    let result = '# 5인 이상 연번 복구 결과 상세표 (총 85건)\n\n';

    const order = ['천안', '평택', '대전'];
    for (const office of Object.keys(grouped)) {
        if (!order.includes(office)) order.push(office);
    }

    for (const office of order) {
        const items = grouped[office];
        if (!items || items.length === 0) continue;

        result += `## 📍 ${office}지청 (${items.length}건)\n`;
        result += `| 업체명 | ❌ 수정 전 | ✅ 복구 완료 | 총인원 | 측정일 |\n`;
        result += `|:---|:---:|:---:|:---:|:---:|\n`;

        for (const item of items) {
            result += `| ${item.name} | ${item.bad} | **${item.good}** | ${item.employees}명 | ${item.dates} |\n`;
        }
        result += '\n';
    }

    const outPath = 'C:/Users/USER/.gemini/antigravity/brain/79f0fbc1-47d3-4da9-891f-2e79853531bd/sequence_changes_report.md';
    fs.writeFileSync(outPath, result, 'utf8');
    console.log('Artifact rebuilt with total employees!');
}

main();
