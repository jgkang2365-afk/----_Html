
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkPeriods() {
    const { data, error } = await supabase.from('measurement_journal').select('measurement_period');
    if (error) { console.log(error); return; }

    const periods = [...new Set(data.map(d => d.measurement_period))];
    console.log('Distinct Periods:', periods);
}

checkPeriods();
