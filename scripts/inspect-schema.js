
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
    console.log('--- measurement_business ---');
    const { data: bus, error: busError } = await supabase.from('measurement_business').select('*').limit(1);
    if (busError) console.error(busError);
    else if (bus && bus.length > 0) console.log(Object.keys(bus[0]));
    else console.log('No data');

    console.log('--- measurement_journal ---');
    const { data: jour, error: jourError } = await supabase.from('measurement_journal').select('*').limit(1);
    if (jourError) console.error(jourError);
    else if (jour && jour.length > 0) console.log(Object.keys(jour[0]));
    else console.log('No data');
}

inspect();
