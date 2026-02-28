import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data, error } = await supabase.rpc('get_column_info', { p_table_name: 'measurement_journal', p_column_name: 'note' });
    if (error) {
        // try different approach
        const { data: d2, error: e2 } = await supabase.from('measurement_journal').select('note').limit(1);
        console.log("Just testing connection:", d2, e2);
    } else {
        console.log(data);
    }
}
main();
