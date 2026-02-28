import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data } = await supabase
        .from('measurement_journal')
        .select('id, designated_office, business_name, sequence_number, five_plus_sequence, total_employees, created_at, updated_at')
        .eq('measurement_year', 2026)
        .not('sequence_number', 'is', null)

    if (!data) return;

    data.sort((a, b) => a.id - b.id);

    let issues = [];
    const offices = [...new Set(data.map(d => d.designated_office))];

    for (const office of offices) {
        const officeData = data.filter(d => d.designated_office === office);

        for (const d of officeData) {
            if (!d.five_plus_sequence) continue;
            const currentSeq = parseInt(d.five_plus_sequence);

            const newerButSmaller = officeData.filter(other =>
                other.id > d.id &&
                parseInt(other.five_plus_sequence) < currentSeq &&
                new Date(d.updated_at) > new Date(other.created_at)
            );

            if (newerButSmaller.length > 0) {
                issues.push({
                    office: d.designated_office,
                    name: d.business_name,
                    current_five_seq: d.five_plus_sequence,
                    created_at: d.created_at,
                    updated_at: d.updated_at,
                });
            }
        }
    }

    issues.sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());

    let report = "# 연번 덮어쓰기 의심 사업장 리스트 (수정일자순)\n\n"

    for (const issue of issues) {
        report += `### [${issue.office}] ${issue.name}\n`;
        report += `- **부여된 5인 연번**: ${issue.current_five_seq}\n`;
        report += `- **최초 생성일**: ${new Date(issue.created_at).toLocaleString()}\n`;
        report += `- **마지막 수정일(오류 발생 시점 추정)**: ${new Date(issue.updated_at).toLocaleString()}\n\n`;
    }

    report += `\n**총 ${issues.length}건**`

    fs.writeFileSync('corrupted_report.md', report);
    console.log("Wrote to corrupted_report.md");
}
main();
