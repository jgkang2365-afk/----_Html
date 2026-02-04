
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseKey);

async function inspect() {
    console.log('--- measurement_target_business ---');
    const { data, error } = await supabase.from('measurement_target_business').select('*').limit(1);
    if (error) {
        console.error(error);
    } else if (data && data.length > 0) {
        console.log('Columns:', Object.keys(data[0]));
    } else {
        console.log('No data found, cannot infer schema easily.');
    }

    console.log('\n--- measurement_business ---');
    const { data: mbData, error: mbError } = await supabase.from('measurement_business').select('*').limit(1);
    if (mbError) {
        console.error(mbError);
    } else if (mbData && mbData.length > 0) {
        console.log('Columns:', Object.keys(mbData[0]));
    } else {
        console.log('No data found for measurement_business.');
    }
}

inspect();
