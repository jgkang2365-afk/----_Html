
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkH0205() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, five_plus_sequence, measurement_period, measurement_year')
        .eq('code', 'H0205')
        .single();

    if (error) { console.log(error); return; }
    console.log(`H0205 5+ Sequence: ${data.five_plus_sequence}`);
    console.log(data);
}

checkH0205();
