import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, note, business_name, measurement_year, measurement_period, code')
        .not('note', 'is', null);

    if (error) {
        console.error("조회 에러:", error);
        return;
    }

    const truncated = data?.filter(d => typeof d.note === 'string' && d.note.length >= 45);
    console.log(`총 조회: ${data?.length}건`);
    console.log(`길이 45자 이상 (잘림 의심 데이터): ${truncated?.length}건\n`);

    if (truncated && truncated.length > 0) {
        console.log("=== 복구 대상 상세 목록 ===");
        for (const d of truncated) {
            // 해당 사업장의 과거 데이터 중 정상적인 note(체크박스값)를 가진 가장 최근 기록 조회
            const { data: pastData } = await supabase
                .from('measurement_journal')
                .select('note')
                .eq('code', d.code)
                .lt('measurement_year', d.measurement_year)
                .order('measurement_year', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(3);

            console.log(`- [${d.measurement_year} ${d.measurement_period}] ${d.business_name}`);
            console.log(`  현재 불완전한 값: "${d.note}"`);

            const potentialRecoveries = pastData
                ?.filter(p => p.note && !p.note.includes(':'))
                .map(p => p.note);

            if (potentialRecoveries && potentialRecoveries.length > 0) {
                console.log(`  💡 복구 제안 (과거 체크박스 이력): "${potentialRecoveries[0]}"`);
            } else {
                console.log(`  ⚠️ 무에서 유를 창조할 수 없음. 과거 순수 체크박스 이력 없음.`);
            }
            console.log("");
        }
    }
}
main();
