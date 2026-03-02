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
    };
    return map[fullName] || fullName;
}

async function main() {
    // Read the log file as UTF-16LE (as PowerShell > created it)
    // Actually, we'll try reading it as utf8 first, which produced exactly what we saw in the previous view_file.
    let content = '';
    try {
        content = fs.readFileSync('recovery_log2.txt', 'utf8');
    } catch (e) {
        console.error('Could not read recovery_log.txt');
        return;
    }

    const lines = content.split('\n');
    const records: Record<string, { id: number, badNum: string, goodNum: string }> = {};

    let currentId: number | null = null;
    let currentBadNum: string | null = null;
    let currentGoodNum: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Look for ID
        const idMatch = line.match(/\(ID:\s*(\d+)\)/);
        if (idMatch) {
            // Save previous if any
            if (currentId && currentGoodNum) {
                records[currentId] = { id: currentId, badNum: currentBadNum || '', goodNum: currentGoodNum };
            }
            currentId = parseInt(idMatch[1], 10);
            currentBadNum = null;
            currentGoodNum = null;
            continue;
        }

        // Since the mojibake contains the numbers at the end after a colon and a space
        // e.g. "   - ???꾩옱 瑗ъ씤 踰덊샇: 40" -> bad num is 40
        // "   - ??蹂듭썝?섏뼱?????먮옒 踰덊샇: 6" -> good num is 6
        if (currentId !== null) {
            if (line.includes('40')) { /* debug */ }

            const numMatch = line.match(/:\s*(\d+)\s*$/);
            if (numMatch) {
                const num = numMatch[1];
                // The first number matched after the ID is usually the bad number
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

    if (ids.length === 0) {
        console.error('No IDs successfully parsed!');
        return;
    }

    // Fetch business info from DB for these IDs
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, designated_office, business_name')
        .in('id', ids);

    if (error || !data) {
        console.error('DB fetch failed', error);
        return;
    }

    // Generate beautiful markdown
    let result = '# 5인 이상 연번 복구 결과 상세 확인표\n\n' +
        '> 본인이 수기로 애써 고치셨던 내역을 시스템이 어떻게 덮어썼는지 한눈에 확인해 보세요.\n' +
        '> **✅ 복구된 완료 번호**는 "측정일지가 시스템에 가장 처음 생성된 시간순서" 논리에 의해 수학적으로 도출된 최종 정상 번호입니다.\n\n' +
        '| 소속 | 사업장명 | ❌ 수정 전 꼬인 번호 (버그) | ✅ 복구 완료된 정상 앞번호 |\n' +
        '|:---:|:---|:---:|:---:|\n';

    // Sort by restored sequential number
    const enriched = data.map(dbRow => {
        const rec = records[dbRow.id];
        return {
            office: toShortName(dbRow.designated_office || ''),
            name: dbRow.business_name || '',
            badNum: rec.badNum,
            goodNum: rec.goodNum
        };
    }).sort((a, b) => parseInt(a.goodNum) - parseInt(b.goodNum));

    for (const item of enriched) {
        result += `| ${item.office} | ${item.name} | ${item.badNum} | **${item.goodNum}** |\n`;
    }

    const outPath = 'C:/Users/USER/.gemini/antigravity/brain/79f0fbc1-47d3-4da9-891f-2e79853531bd/sequence_changes_report.md';
    fs.writeFileSync(outPath, result, 'utf8');
    console.log('Artifact perfectly generated at:', outPath);
}

main();
