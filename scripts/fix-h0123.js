
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fixH0123() {
    console.log('Fixing H0123 sequence number...');

    // Find H0123
    const { data: journal, error } = await supabase
        .from('measurement_journal')
        .select('id, code, five_plus_sequence, measurement_period, designated_office')
        .eq('code', 'H0123')
        .eq('measurement_year', 2026)
        .single();

    if (error) {
        console.error('Error finding H0123:', error);
        return;
    }

    if (!journal) {
        console.error('H0123 not found');
        return;
    }

    console.log(`Current H0123: Period=${journal.measurement_period}, Seq=${journal.five_plus_sequence}`);

    if (journal.five_plus_sequence === '9' || journal.five_plus_sequence === '10') {
        const { error: updateError } = await supabase
            .from('measurement_journal')
            .update({ five_plus_sequence: '11' })
            .eq('id', journal.id);

        if (updateError) {
            console.error('Update failed:', updateError);
        } else {
            console.log('Successfully updated H0123 to sequence 11');
        }
    } else {
        console.log(`H0123 sequence is ${journal.five_plus_sequence}. Skipping update (expected 9 or 10).`);
    }
}

fixH0123();
