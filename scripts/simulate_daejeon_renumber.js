
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function simulateRenumbering() {
    console.log('Simulating Daejeon 2026 Re-serialization...');

    const { data: journals, error } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, five_plus_sequence, measurement_period, total_employees, created_at, designated_office')
        .eq('measurement_year', 2026)
        .in('designated_office', ['대전', '대전청'])
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    if (!journals || journals.length === 0) {
        console.log('No data found for Daejeon 2026.');
        return;
    }

    let currentMax = 0;
    const results = [];

    // Logic Application
    journals.forEach((j) => {
        const oldSeq = parseInt(j.five_plus_sequence || '0', 10);
        const empCount = j.total_employees || 0;

        let newSeq = 0;

        if (empCount >= 5) {
            // 5인 이상: 새 번호 부여 (MAX + 1)
            currentMax++;
            newSeq = currentMax;
        } else {
            // 5인 미만: 직전 번호 재사용 (MAX)
            // 만약 첫 데이터가 5인 미만이면 1번 부여 (Edge case)
            if (currentMax === 0) {
                currentMax = 1;
            }
            newSeq = currentMax;
        }

        results.push({
            ...j,
            oldSeq,
            newSeq,
            isChanged: oldSeq !== newSeq
        });
    });

    // Generate Report Table
    let report = `# 대전지청 2026년 연번 재부여 시뮬레이션 결과\n`;
    report += `\n**생성일시 기준 정렬 및 신규 로직(5인 이상 +1, 미만 재사용) 적용 결과입니다.**\n\n`;
    report += `| 순서 | 생성일시 | 업체명 (코드) | 인원 | 기존 연번 | **변경 연번** | 변경 여부 |\n`;
    report += `| :--- | :--- | :--- | :---: | :---: | :---: | :---: |\n`;

    results.forEach((r, idx) => {
        const date = new Date(r.created_at).toLocaleString('ko-KR', {
            year: '2-digit', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const changeMark = r.isChanged ? '🔴 **변경**' : '✅ 유지';
        const rowStyle = r.isChanged ? '**' : ''; // Highlight content if changed

        report += `| ${idx + 1} | ${date} | ${r.business_name} (${r.code}) | ${r.total_employees} | ${r.oldSeq} | **${r.newSeq}** | ${changeMark} |\n`;
    });

    fs.writeFileSync('daejeon_renumber_preview.md', report);
    console.log('Simulation complete. Report saved to daejeon_renumber_preview.md');
}

simulateRenumbering();
