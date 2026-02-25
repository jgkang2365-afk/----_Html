import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function fixK2bStatus() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .update({
            k2b_status: '정상처리',
            k2b_send_date: '2026-02-25'
        })
        .eq('code', 'H0240')
        .eq('measurement_year', 2026)
        .eq('measurement_period', '상반기');

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Update successful for H0240');
    }
}

fixK2bStatus();
