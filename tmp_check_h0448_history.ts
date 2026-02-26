
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHistory() {
    console.log('Checking all records for code H0448 in all relevant tables...');

    const { data: info } = await supabase.from('business_info').select('*').eq('code', 'H0448');
    console.log('business_info:', info);

    const { data: measurement } = await supabase.from('measurement_business').select('*').eq('code', 'H0448');
    console.log('measurement_business:', measurement);

    const { data: journals } = await supabase.from('measurement_journal').select('*').eq('code', 'H0448');
    console.log('measurement_journal:', journals);

    const { data: samil } = await supabase.from('measurement_business').select('*').ilike('business_name', '%삼일%');
    console.log('Any Samil records in measurement_business:', samil?.map(s => ({ code: s.code, name: s.business_name, year: s.year, period: s.period })));
}

checkHistory();
