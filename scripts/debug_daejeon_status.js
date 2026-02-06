
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkDaejeonStatus() {
    console.log('Analyzing Daejeon 2026 Data Status...');

    const { data: journals, error } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, five_plus_sequence, measurement_period, total_employees, created_at, designated_office')
        .eq('measurement_year', 2026)
        .in('designated_office', ['대전', '대전청'])
        // Sort by sequence number string converted to int for proper numerical order
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    if (!journals || journals.length === 0) {
        console.log('No data found for Daejeon 2026.');
        return;
    }

    console.log(`Total Records: ${journals.length}`);
    console.log('------------------------------------------------------------------------------------------------');
    console.log('IDX | Created At             | Seq | Code  | Business Name        | Period | Emp | Status');
    console.log('------------------------------------------------------------------------------------------------');

    const sequenceCounts = {};
    journals.forEach(j => {
        const seq = j.five_plus_sequence;
        sequenceCounts[seq] = (sequenceCounts[seq] || 0) + 1;
    });

    journals.forEach((j, index) => {
        const isDuplicate = sequenceCounts[j.five_plus_sequence] > 1;
        const status = isDuplicate ? 'DUPLICATE' : 'OK';
        const date = new Date(j.created_at).toLocaleString('ko-KR');
        console.log(`${String(index + 1).padEnd(3)} | ${date.padEnd(20)} | ${String(j.five_plus_sequence).padStart(3)} | ${j.code} | ${j.business_name.padEnd(20)} | ${j.measurement_period} | ${String(j.total_employees).padStart(3)} | ${status}`);
    });
}

checkDaejeonStatus();
