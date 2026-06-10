import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDataTypes() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('code, measurement_year, measurement_period, k2b_status, k2b_send_date')
        .eq('code', 'H0242')
        .eq('measurement_year', 2026);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('--- DB Data Inspection (H0242) ---');
    data.forEach(row => {
        console.log(`Code: [${row.code}] (${typeof row.code})`);
        console.log(`Year: [${row.measurement_year}] (${typeof row.measurement_year})`);
        console.log(`Period: [${row.measurement_period}] (${typeof row.measurement_period})`);
        console.log(`Status: [${row.k2b_status}]`);
        console.log(`Send Date: [${row.k2b_send_date}]`);
        console.log('---------------------------------');
    });
}

checkDataTypes();
