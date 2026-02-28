import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data } = await supabase.from('measurement_journal').select('code, business_name, measurement_year, measurement_period, note').not('note', 'is', null);
    const truncated = data?.filter(d => typeof d.note === 'string' && d.note.length >= 45);

    if (truncated) {
        for (const t of truncated) {
            const { data: past } = await supabase.from('measurement_journal').select('measurement_year, measurement_period, note').eq('code', t.code).lt('measurement_year', t.measurement_year);
            console.log('Truncated:', t.business_name, t.measurement_year, t.note);
            console.log('Past:', past);
            console.log('---');
        }
    }
}
main();
