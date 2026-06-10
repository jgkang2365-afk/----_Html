import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBusinessData() {
    const { data, error } = await supabase
        .from('measurement_business')
        .select('code, business_name, year, period')
        .eq('code', 'H0242')
        .eq('year', 2026);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('--- DB Business Inspection (H0242) ---');
    data.forEach(row => {
        console.log(`Code: [${row.code}]`);
        console.log(`Year: [${row.year}] (${typeof row.year})`);
        console.log(`Period: [${row.period}] (${typeof row.period})`);
        console.log('---------------------------------');
    });
}

checkBusinessData();
