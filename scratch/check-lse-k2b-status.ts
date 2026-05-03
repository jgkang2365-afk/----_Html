import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStatus() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('business_name, k2b_status, k2b_send_date, k2b_sender, measurement_year, measurement_period, code')
        .ilike('business_name', '%엘에스이%')
        .order('measurement_year', { ascending: false })
        .order('measurement_period', { ascending: false });

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    console.log('--- 주식회사 엘에스이 K2B Status ---');
    data.forEach(row => {
        console.log(`Business: ${row.business_name} (${row.code}) (${row.measurement_year} ${row.measurement_period})`);
        console.log(`Status: ${row.k2b_status}`);
        console.log(`Send Date: ${row.k2b_send_date}`);
        console.log(`Sender: ${row.k2b_sender}`);
        console.log('-----------------------------------');
    });
}

checkStatus();
