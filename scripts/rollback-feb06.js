
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function rollbackData() {
    console.log('Rolling back data (Deleting H0123, H0067, H0068)...');

    const codesToDelete = ['H0123', 'H0067', 'H0068'];

    // 1. Verify existence first
    const { data: toDelete, error: fetchError } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, designated_office, created_at')
        .in('code', codesToDelete)
        .eq('measurement_year', 2026);

    if (fetchError) {
        console.error('Error fetching data:', fetchError);
        return;
    }

    if (!toDelete || toDelete.length === 0) {
        console.log('No matching records found to delete.');
        return;
    }

    console.log('Found records to delete:');
    toDelete.forEach(j => {
        console.log(`- ${j.code} (${j.business_name}) / ${j.designated_office} / Created: ${j.created_at}`);
    });

    // 2. Delete
    const { error: deleteError } = await supabase
        .from('measurement_journal')
        .delete()
        .in('id', toDelete.map(j => j.id));

    if (deleteError) {
        console.error('Delete failed:', deleteError);
    } else {
        console.log(`Successfully deleted ${toDelete.length} records.`);
    }
}

rollbackData();
