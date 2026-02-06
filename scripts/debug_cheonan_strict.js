
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkCheonanStrict() {
    console.log('Analyzing Cheonan 2026 Data (Strict Mode)...');

    const { data: journals, error } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, five_plus_sequence, measurement_period, designated_office, created_at')
        .eq('measurement_year', 2026)
        .in('designated_office', ['천안', '천안지청', ' 천안 ', '천안 ']) // Try variations just in case
        .order('five_plus_sequence', { ascending: true }); // String sort

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Total Records: ${journals.length}`);
    console.log('--------------------------------------------------------------------------------');
    console.log('Seq | Code  | Business Name        | [Office]   | [Period]   | Created At');
    console.log('--------------------------------------------------------------------------------');

    journals.forEach(j => {
        // Use brackets to reveal whitespace
        const office = `[${j.designated_office}]`;
        const period = `[${j.measurement_period}]`;
        const seq = String(j.five_plus_sequence).padStart(3);
        const name = j.business_name.substring(0, 20).padEnd(20);
        const date = new Date(j.created_at).toLocaleString('ko-KR');

        console.log(`${seq} | ${j.code} | ${name} | ${office.padEnd(10)} | ${period.padEnd(10)} | ${date}`);
    });
}

checkCheonanStrict();
