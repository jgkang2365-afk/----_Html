import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';
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
        .in('five_plus_sequence', ['91', '92', '93']);

    if (data) {
        data.sort((a, b) => parseInt(a.five_plus_sequence || '0') - parseInt(b.five_plus_sequence || '0'));
        fs.writeFileSync('history.json', JSON.stringify(data, null, 2));
        console.log("Wrote to history.json");
    }
}
main();
