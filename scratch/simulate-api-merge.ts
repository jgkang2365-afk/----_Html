import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function simulateApi() {
    // 1. Get businesses (like the API does)
    const { data: businesses, error: bError } = await supabase
        .from('measurement_business')
        .select('code, business_name, year, period')
        .eq('year', 2026)
        .eq('period', '상반기')
        .ilike('business_name', '%엘에스이%');

    if (bError) {
        console.error('Business Error:', bError);
        return;
    }

    console.log(`Found ${businesses.length} businesses matching '엘에스이'`);

    const codes = Array.from(new Set(businesses.map(d => d.code)));
    
    // 2. Get journals (like the API does)
    const { data: journals, error: jError } = await supabase
        .from('measurement_journal')
        .select('code, measurement_year, measurement_period, k2b_send_date, k2b_status')
        .in('code', codes)
        .eq('measurement_year', 2026)
        .eq('measurement_period', '상반기');

    if (jError) {
        console.error('Journal Error:', jError);
        return;
    }

    console.log(`Found ${journals.length} journals matching the codes`);

    // 3. Merge (like the API does)
    const mergedData = businesses.map(record => {
        const journal = journals?.find(j => 
            j.code === record.code && 
            j.measurement_year === record.year && 
            j.measurement_period === record.period
        );
        return {
            business_name: record.business_name,
            code: record.code,
            year: record.year,
            period: record.period,
            k2b_send_date: journal?.k2b_send_date || null,
            k2b_status: journal?.k2b_status || null
        };
    });

    console.log('--- Simulation Result ---');
    console.log(JSON.stringify(mergedData, null, 2));
}

simulateApi();
