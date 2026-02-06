
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkSpecificJournals() {
    const codes = ['H0123', 'H0239', 'H0437', 'H0438'];
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, measurement_period, five_plus_sequence, total_employees, created_at')
        .in('code', codes);

    if (error) console.log(error);
    console.log(data);
}

checkSpecificJournals();
