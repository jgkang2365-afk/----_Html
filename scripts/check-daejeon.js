
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkDaejeon() {
    console.log('Checking Daejeon 2026 data...');
    const { data: journals, error } = await supabase
        .from('measurement_journal')
        .select('code, business_name, five_plus_sequence, measurement_period, total_employees, created_at, designated_office')
        .eq('measurement_year', 2026)
        .in('designated_office', ['대전', '대전청']) // Check variations
        .order('created_at');

    if (error) {
        console.error(error);
        return;
    }

    if (!journals || journals.length === 0) {
        console.log('No data for Daejeon 2026');
        return;
    }

    journals.forEach((j, i) => {
        console.log(`${i + 1}. Code=${j.code}, Name=${j.business_name}, Period=${j.measurement_period}, Seq=${j.five_plus_sequence}, Emp=${j.total_employees}, Office=${j.designated_office}`);
    });
}

checkDaejeon();
