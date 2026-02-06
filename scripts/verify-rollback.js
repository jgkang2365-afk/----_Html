
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function verifyRollback() {
    console.log('Verifying rollback status...');

    const codesToCheck = ['H0123', 'H0067', 'H0068'];

    const { data: records, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, created_at, designated_office')
        .in('code', codesToCheck)
        .eq('measurement_year', 2026);

    if (error) {
        console.error('Error checking records:', error);
        return;
    }

    if (!records || records.length === 0) {
        console.log('SUCCESS: No records found for H0123, H0067, H0068 in 2026.');
    } else {
        console.log('WARNING: Records still exist!');
        records.forEach(r => {
            console.log(`- Found: ${r.code} (${r.business_name}) created at ${r.created_at}`);
        });
    }
}

verifyRollback();
