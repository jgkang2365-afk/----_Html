
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function inspectH0231() {
    console.log('Inspecting H0231 Data...');

    // 1. Check Target Business Table
    const { data: targets, error: targetError } = await supabase
        .from('measurement_target_business')
        .select('*')
        .eq('code', 'H0231')
        .eq('year', 2026);

    if (targetError) console.error('Target Error:', targetError);
    else {
        console.log('\n[Target Business Records]');
        targets.forEach(t => {
            console.log(`- ID: ${t.id}, Period: ${t.period}, Status: ${t.status}, Manager: ${t.manager_name}, Updated: ${t.updated_at}`);
        });
    }

    // 2. Check Journal Table
    const { data: journals, error: journalError } = await supabase
        .from('measurement_journal')
        .select('*')
        .eq('code', 'H0231')
        .eq('measurement_year', 2026);

    if (journalError) console.error('Journal Error:', journalError);
    else {
        console.log('\n[Journal Records]');
        journals.forEach(j => {
            console.log(`- ID: ${j.id}, Period: ${j.measurement_period}, Created: ${j.created_at}`);
        });
    }
}

inspectH0231();
