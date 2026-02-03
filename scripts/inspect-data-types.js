
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseKey);

async function inspect() {
    console.log('--- measurement_target_business data sample ---');
    const { data, error } = await supabase.from('measurement_target_business').select('*').limit(3);
    if (error) {
        console.error(error);
    } else if (data && data.length > 0) {
        const row = data[0];
        console.log('Sample Row:', row);
        console.log('Type of is_registered:', typeof row.is_registered);
        console.log('Value of is_registered:', row.is_registered);
        console.log('Type of measurer_id:', typeof row.measurer_id);
        console.log('Type of future_measurement_period:', typeof row.future_measurement_period);
    } else {
        console.log('No data found.');
    }
}

inspect();
