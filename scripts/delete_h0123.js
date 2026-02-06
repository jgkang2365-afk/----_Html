
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function deleteH0123() {
    console.log('Deleting H0123 (Cheonan) for clean retry...');

    const { error } = await supabase
        .from('measurement_journal')
        .delete()
        .eq('code', 'H0123')
        .eq('measurement_year', 2026);

    if (error) {
        console.error('Error deleting H0123:', error);
    } else {
        console.log('H0123 deleted successfully (if it existed).');
    }
}

deleteH0123();
