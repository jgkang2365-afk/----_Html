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
        console.error('Could not read recovery_log.txt');
        return;
    }

    const lines = content.split('\n');
    const records: Record<string, { id: number, badNum: string }> = {};

    let currentId: number | null = null;
    let currentBadNum: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const idMatch = line.match(/\(ID:\s*(\d+)\)/);
        if (idMatch) {
            if (currentId && currentBadNum) {
                records[currentId] = { id: currentId, badNum: currentBadNum };
            }
            currentId = parseInt(idMatch[1], 10);
            currentBadNum = null;
            continue;
        }

        if (currentId !== null && currentBadNum === null) {
            const numMatch = line.match(/:\s*(\d+)\s*$/);
            if (numMatch) {
                currentBadNum = numMatch[1];
            }
        }
    }

    if (currentId && currentBadNum) {
        records[currentId] = { id: currentId, badNum: currentBadNum };
    }

    const ids = Object.keys(records).map(id => parseInt(id, 10));

    if (ids.length === 0) return;

    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, designated_office, business_name, measurement_start_date, measurement_end_date, five_plus_sequence')
        .in('id', ids);

    if (error || !data) {
        console.error('DB fetch failed', error);
        return;
    }

    const enriched = data.map(dbRow => {
        const rec = records[dbRow.id];
        return {
            office: toShortName(dbRow.designated_office),
            name: dbRow.business_name || '',
            dates: formatDateRange(dbRow.measurement_start_date, dbRow.measurement_end_date),
            badNum: rec.badNum,
            goodNum: dbRow.five_plus_sequence
        };
    }).sort((a, b) => parseInt(a.goodNum) - parseInt(b.goodNum));

    const grouped: Record<string, typeof enriched> = {};

    for (const item of enriched) {
        if (!grouped[item.office]) grouped[item.office] = [];
        grouped[item.office].push(item);
    }

    let result = '';

    const order = ['천안', '평택', '대전'];
    for (const office of Object.keys(grouped)) {
        if (!order.includes(office)) order.push(office);
    }

    // Format requested by user:
    // 천안지청
    // 업체명, 00, 00, 측정일
    for (const office of order) {
        const items = grouped[office];
        if (!items || items.length === 0) continue;

        result += `${office}지청\n`;

        for (const item of items) {
            result += `${item.name}, ${item.badNum}, ${item.goodNum}, ${item.dates}\n`;
        }
        result += '\n';
    }

    const outPath = 'C:/Users/USER/.gemini/antigravity/brain/79f0fbc1-47d3-4da9-891f-2e79853531bd/sequence_changes_report.md';
    fs.writeFileSync(outPath, result.trimEnd() + '\n', 'utf8');
    console.log('Artifact fully rebuilt in plain list format!');
}

main();
