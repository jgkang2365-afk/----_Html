import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkExactValues() {
    const { data: b } = await supabase
        .from('measurement_business')
        .select('*')
        .eq('code', 'H0242')
        .eq('year', 2026)
        .eq('period', '상반기');

    const { data: j } = await supabase
        .from('measurement_journal')
        .select('*')
        .eq('code', 'H0242')
        .eq('measurement_year', 2026)
        .eq('measurement_period', '상반기');

    console.log('Business Record:', JSON.stringify(b, null, 2));
    console.log('Journal Record:', JSON.stringify(j, null, 2));

    if (b && j && b[0] && j[0]) {
        console.log('Code Match:', b[0].code === j[0].code);
        console.log('Year Match:', b[0].year === j[0].measurement_year);
        console.log('Period Match:', b[0].period === j[0].measurement_period);
    }
}

checkExactValues();
