import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const codes = ['H0270', 'H0240', 'H0439', 'H0438', 'H0437', 'H0239'];

async function checkFinal() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, five_plus_sequence, measurement_start_date')
        .in('code', codes)
        .eq('measurement_year', 2026);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('--- Final DB Status ---');
        console.log(JSON.stringify(data, null, 2));
    }
}

checkFinal();
