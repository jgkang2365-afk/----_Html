
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function verifyFilter() {
    console.log('Verifying Period Filter for H0231 (2026 Regular)...');

    // Mimic the fixed query: Year 2026, Period "상반기"
    const { data, error } = await supabase
        .from('preliminary_survey')
        .select('code')
        .eq('code', 'H0231')
        .eq('year', 2026)
        .eq('period', '상반기'); // Strict filter

    if (error) {
        console.error('Error:', error);
    } else {
        console.log(`Found Surveys (Should be 0): ${data.length}`);
        if (data.length === 0) {
            console.log("PASS: No 'Regular' survey found. Logic will default to 'Unconfirmed' (or whatever is set).");
        } else {
            console.log("FAIL: Survey found! Logic will force 'Confirmed'.");
        }
    }
}

verifyFilter();
