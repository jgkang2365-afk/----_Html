
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkSpecificJournals() {
    const codes = ['H0123', 'H0239', 'H0437', 'H0438', 'H0205'];
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, measurement_period, five_plus_sequence, total_employees, created_at, designated_office, measurement_year')
        .in('code', codes)
        .order('created_at');

    if (error) {
        console.error(error);
        return;
    }

    fs.writeFileSync('debug_journals.json', JSON.stringify(data, null, 2));
    console.log('Done writing debug_journals.json');
}

checkSpecificJournals();
