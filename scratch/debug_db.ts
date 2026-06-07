import { createClient } from "@supabase/supabase-js";
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log("=== 저널 누락 사업장 검사 ===");

    // 1. measurement_business 전체 조회 (2026년 상반기)
    const { data: businessList, error: bError } = await supabase
        .from('measurement_business')
        .select('code, business_name, year, period')
        .eq('year', 2026)
        .eq('period', '상반기')
        .not('business_name', 'ilike', '%번외%');

    if (bError) {
        console.error("measurement_business 조회 에러:", bError);
        return;
    }

    console.log(`2026년 상반기 measurement_business 개수: ${businessList.length}`);

    // 2. measurement_journal 전체 조회 (2026년 상반기)
    const { data: journalList, error: jError } = await supabase
        .from('measurement_journal')
        .select('code, business_name, measurement_year, measurement_period')
        .eq('measurement_year', 2026)
        .eq('measurement_period', '상반기');

    if (jError) {
        console.error("measurement_journal 조회 에러:", jError);
        return;
    }

    console.log(`2026년 상반기 measurement_journal 개수: ${journalList.length}`);

    // 3. 누락된 사업장 비교
    const journalCodes = new Set(journalList.map(j => j.code));
    const missingJournals = businessList.filter(b => !journalCodes.has(b.code));

    console.log(`\n측정일지(journal)가 존재하지 않는 사업장 수: ${missingJournals.length}`);
    if (missingJournals.length > 0) {
        console.log("누락 샘플 (최대 10개):");
        missingJournals.slice(0, 10).forEach(m => {
            console.log(`- 코드: ${m.code}, 사업장명: ${m.business_name}`);
        });
    }
}

main().catch(console.error);
