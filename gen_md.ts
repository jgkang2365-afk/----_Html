import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';
import 'dotenv/config';

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
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, designated_office, measurement_year, measurement_period, total_employees, five_plus_sequence, business_name, created_at, updated_at')
        .eq('measurement_year', 2026)
        .not('sequence_number', 'is', null)
        .order('created_at', { ascending: true });

    if (error || !data) return;

    const tracker: Record<string, number> = {};
    const fixes = [];

    for (const journal of data) {
        if (!journal.designated_office || !journal.measurement_period) continue;

        const office = toShortName(journal.designated_office);
        const key = `${office}_${journal.measurement_year}_${journal.measurement_period}`;
        if (tracker[key] === undefined) tracker[key] = 0;

        const empCount = journal.total_employees ? Number(journal.total_employees) : 0;
        let expectedNumberStr = "0";

        if (empCount >= 5) {
            tracker[key] += 1;
            expectedNumberStr = String(tracker[key]);
        } else {
            if (tracker[key] > 0) {
                expectedNumberStr = String(tracker[key]);
            } else {
                expectedNumberStr = "0";
            }
        }

        const actualNumberStr = journal.five_plus_sequence;
        if (actualNumberStr !== expectedNumberStr) {
            fixes.push({
                office: office,
                name: journal.business_name,
                actual: actualNumberStr,
                expected: expectedNumberStr
            });
        }
    }

    let result = '# 5인 이상 연번 복구 결과 상세 확인표\n\n' +
        '> 사용자님께서 **직접 확인이나 수정을 진행하고 계셨던 부분**이 있을 수 있어, 복원을 진행한 **전체 내역(비포 & 애프터)**을 표로 정리해 드립니다.\n' +
        '> 본인이 수기로 애써 고치셨던 내역을 스크립트가 다른 번호로 덮어썼는지 (정합성이 맞는지) 한눈에 확인해 보세요.\n\n' +
        '| 소속 | 사업장명 | ❌ 수정 전 꼬인 번호 (버그) | ✅ 복구된 원래 앞번호 (자동) |\n' +
        '|:---:|:---|:---:|:---:|\n';

    for (const fix of fixes) {
        result += `| ${fix.office} | ${fix.name} | ${fix.actual} | **${fix.expected}** |\n`;
    }

    fs.writeFileSync('C:/Users/USER/Desktop/cursor/측정일지_html/mapping.txt', result, 'utf8');
    console.log('done');
}
main();
