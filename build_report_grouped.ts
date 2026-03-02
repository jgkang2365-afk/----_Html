import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';
import 'dotenv/config';

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function toShortName(fullName: string) {
    const map: Record<string, string> = {
        "대전지방고용노동청": "대전",
        "대전지방고용노동청 청주지청": "청주",
        "대전지방고용노동청 천안지청": "천안",
        "대전지방고용노동청 충주지청": "충주",
        "대전지방고용노동청 보령지청": "보령",
        "대전지방고용노동청 서산출장소": "서산",
        "중부지방고용노동청 평택지청": "평택", // Added Pyeongtaek just in case
    };
    // Sometimes it's already short or has a different format, checking if contains:
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
        content = fs.readFileSync('recovery_log2.txt', 'utf8');
    } catch (e) {
        console.error('Could not read recovery_log2.txt');
        return;
    }

    const lines = content.split('\n');
    const records: Record<string, { id: number, badNum: string, goodNum: string }> = {};

    let currentId: number | null = null;
    let currentBadNum: string | null = null;
    let currentGoodNum: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const idMatch = line.match(/\(ID:\s*(\d+)\)/);
        if (idMatch) {
            if (currentId && currentGoodNum) {
                records[currentId] = { id: currentId, badNum: currentBadNum || '', goodNum: currentGoodNum };
            }
            currentId = parseInt(idMatch[1], 10);
            currentBadNum = null;
            currentGoodNum = null;
            continue;
        }

        if (currentId !== null) {
            const numMatch = line.match(/:\s*(\d+)\s*$/);
            if (numMatch) {
                const num = numMatch[1];
                if (currentBadNum === null) {
                    currentBadNum = num;
                } else if (currentGoodNum === null) {
                    currentGoodNum = num;
                }
            }
        }
    }

    if (currentId && currentGoodNum) {
        records[currentId] = { id: currentId, badNum: currentBadNum || '', goodNum: currentGoodNum };
    }

    const ids = Object.keys(records).map(id => parseInt(id, 10));
    console.log(`Extracted ${ids.length} changes from log.`);

    if (ids.length === 0) return;

    // Fetch business info from DB including dates
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, designated_office, business_name, measurement_start_date, measurement_end_date')
        .in('id', ids);

    if (error || !data) {
        console.error('DB fetch failed', error);
        return;
    }

    // Process and Group
    const enriched = data.map(dbRow => {
        const rec = records[dbRow.id];
        return {
            office: toShortName(dbRow.designated_office || ''),
            name: dbRow.business_name || '',
            dates: formatDateRange(dbRow.measurement_start_date, dbRow.measurement_end_date),
            badNum: rec.badNum,
            goodNum: rec.goodNum
        };
    }).sort((a, b) => parseInt(a.goodNum) - parseInt(b.goodNum));

    const grouped: Record<string, typeof enriched> = {
        '천안': [],
        '대전': [],
        '평택': [],
        '기타': []
    };

    for (const item of enriched) {
        if (grouped[item.office]) {
            grouped[item.office].push(item);
        } else {
            grouped['기타'].push(item);
        }
    }

    // Generate Markdown
    let result = '# 5인 이상 연번 복구 결과 상세표 (지청별)\n\n' +
        '> ❌ 수정 전 꼬인 번호 (버그 발생 상태)\n' +
        '> ✅ **복구 완료 번호** (정상 순서대로 재부여됨)\n\n';

    for (const office of ['천안', '대전', '평택', '기타']) {
        const items = grouped[office];
        if (items.length === 0) continue;

        result += `## 📍 ${office} 지청 (${items.length}건)\n\n`;
        result += '| 측정일 | 사업장명 | ❌ 수정 전 | ✅ 복구 완료 |\n';
        result += '|:---|:---|:---:|:---:|\n';

        for (const item of items) {
            result += `| ${item.dates} | ${item.name} | ${item.badNum} | **${item.goodNum}** |\n`;
        }
        result += '\n';
    }

    const outPath = 'C:/Users/USER/.gemini/antigravity/brain/79f0fbc1-47d3-4da9-891f-2e79853531bd/sequence_changes_report.md';
    fs.writeFileSync(outPath, result, 'utf8');
    console.log('Artifact fully rebuilt grouped by office!');
}

main();
