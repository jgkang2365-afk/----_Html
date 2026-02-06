
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function inspectSurvey() {
    console.log('Inspecting Preliminary Survey for H0231 (2026)...');

    const { data, error } = await supabase
        .from('preliminary_survey')
        .select('*')
        .eq('code', 'H0231')
        .eq('year', 2026);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Found Surveys:', data);
    }
}

inspectSurvey();
