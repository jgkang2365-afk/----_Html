import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const updateTargets = [
    { code: 'H0270', business_name: '케이지모빌리티아산서비스센터 주식회사', measurement_date: '2026-02-04', new_seq: '7' },
    { code: 'H0240', business_name: '아산현대서비스 주식회사', measurement_date: '2026-02-04', new_seq: '8' },
    { code: 'H0439', business_name: '입장모터스', measurement_date: '2026-02-04', new_seq: '8' },
    { code: 'H0438', business_name: '삼일공업사', measurement_date: '2026-02-04', new_seq: '8' },
    { code: 'H0437', business_name: '신세계모터스', measurement_date: '2026-02-04', new_seq: '9' },
    { code: 'H0239', business_name: '아산모터스', measurement_date: '2026-02-04', new_seq: '10' }
];

async function runUpdate() {
    console.log('🚀 DB 연번 업데이트를 시작합니다...');

    for (const target of updateTargets) {
        console.log(`\n[업데이트 시도] ${target.business_name} (${target.code})`);

        const { data, error } = await supabase
            .from('measurement_journal')
            .update({ five_plus_sequence: target.new_seq })
            .eq('code', target.code)
            .eq('measurement_start_date', target.measurement_date)
            .eq('measurement_year', 2026)
            .select();

        if (error) {
            console.error(`❌ 에러 발생: ${error.message}`);
        } else if (data && data.length > 0) {
            console.log(`✅ 업데이트 완료: 기존(${data[0].five_plus_sequence}) -> 수정(${target.new_seq})`);
        } else {
            console.log(`⚠️ 일치하는 데이터를 찾을 수 없습니다. (측정일: ${target.measurement_date})`);
        }
    }

    console.log('\n✨ 모든 업데이트 프로세스가 종료되었습니다.');
}

runUpdate();
