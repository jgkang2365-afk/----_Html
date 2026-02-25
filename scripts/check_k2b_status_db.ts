import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function checkK2bStatus() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, measurement_year, measurement_period, k2b_status, k2b_send_date')
        .in('code', ['H0239', 'H0240'])
        .eq('measurement_year', 2026)
        .eq('measurement_period', '상반기');

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Query result:', data);
    }
}

checkK2bStatus();
