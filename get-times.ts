import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data } = await supabase
        .from('measurement_journal')
        .select('sequence_number, five_plus_sequence, total_employees, created_at, business_name')
        .eq('designated_office', '대전')
        .eq('measurement_year', 2026)
        .eq('measurement_period', '상반기')
        .not('sequence_number', 'is', null);

    if (data) {
        data.sort((a, b) => parseInt(b.sequence_number || '0') - parseInt(a.sequence_number || '0'));
        data.slice(0, 10).forEach(d => {
            console.log(`${d.sequence_number.padStart(2)} | 5인:${d.five_plus_sequence?.padStart(2)} | 인원:${String(d.total_employees).padStart(2)} | 생성: ${d.created_at} | ${d.business_name}`);
        });
    }
}
main();
