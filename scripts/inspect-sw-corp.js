
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey || supabaseKey);

async function inspectTarget() {
    const code = 'H0073';
    console.log('--- Inspecting Target for', code, '---');

    const { data, error } = await supabase
        .from('measurement_target_business')
        .select('year, period, business_name, is_registered, previous_measurement_date')
        .eq('code', code)
        .order('year', { ascending: false });

    if (error) {
        console.error('Target Error:', error);
    } else {
        console.log('Found in Target:', JSON.stringify(data, null, 2));
    }
}

inspectTarget();
