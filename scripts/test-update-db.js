
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseKey);

async function testUpdate() {
    console.log('--- Testing DB Update ---');
    // Target: code='H0290', year=2026, period='상반기'

    const updates = {
        notes: 'Test Update ' + new Date().toISOString(),
        is_registered: '미실시', // string based on inspection
        phone: '042-625-1521'
    };

    console.log("Updates:", updates);

    const { data, error } = await supabase
        .from('measurement_target_business')
        .update(updates)
        .eq('code', 'H0290')
        .eq('year', 2026)
        .eq('period', '상반기')
        .select();

    if (error) {
        console.error("Update Failed:", error);
    } else {
        console.log("Update Success:", data);
    }
}

testUpdate();
