import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data } = await supabase
        .from('measurement_journal')
        .select('id, business_name, sequence_number, five_plus_sequence, total_employees, created_at, updated_at')
        .eq('designated_office', '대전')
        .eq('measurement_year', 2026)
        .eq('measurement_period', '상반기')
        .not('sequence_number', 'is', null)

    if (data) {
        data.sort((a, b) => parseInt(b.sequence_number || '0') - parseInt(a.sequence_number || '0'));

        for (const d of data.slice(0, 15)) {
            console.log(`연번: ${d.sequence_number} | 5인: ${d.five_plus_sequence} | 인원: ${d.total_employees} | 생성: ${new Date(d.created_at).toLocaleString()} | 수정: ${new Date(d.updated_at).toLocaleString()} | 이름: ${d.business_name}`);
        }
    }
}
main();
