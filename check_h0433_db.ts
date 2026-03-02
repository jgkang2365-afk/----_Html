import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, five_plus_sequence')
        .eq('code', 'H0433')
        .eq('measurement_year', 2026);
    console.log(JSON.stringify(data, null, 2));
}
check();
