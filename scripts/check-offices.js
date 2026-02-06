
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkOffices() {
    const { data, error } = await supabase.from('measurement_journal').select('designated_office');
    if (error) { console.log(error); return; }

    const offices = [...new Set(data.map(d => d.designated_office))];
    console.log('Distinct Designated Offices:', offices);
}

checkOffices();
