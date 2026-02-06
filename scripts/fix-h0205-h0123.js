
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fixSequences() {
    console.log('Fixing sequences for Cheonan...');

    // 1. Fix H0205 -> 1
    const { data: h0205, error: errH0205 } = await supabase
        .from('measurement_journal')
        .select('id, code, five_plus_sequence')
        .eq('code', 'H0205')
        .eq('measurement_year', 2026)
        .single();

    if (h0205) {
        if (h0205.five_plus_sequence !== '1') {
            console.log(`Updating H0205 from ${h0205.five_plus_sequence} to 1`);
            await supabase.from('measurement_journal').update({ five_plus_sequence: '1' }).eq('id', h0205.id);
        } else {
            console.log('H0205 is already 1');
        }
    } else {
        console.log('H0205 not found', errH0205);
    }

    // 2. Fix H0123 -> 11
    const { data: h0123, error: errH0123 } = await supabase
        .from('measurement_journal')
        .select('id, code, five_plus_sequence')
        .eq('code', 'H0123')
        .eq('measurement_year', 2026)
        .single();

    if (h0123) {
        if (h0123.five_plus_sequence !== '11') {
            console.log(`Updating H0123 from ${h0123.five_plus_sequence} to 11`);
            await supabase.from('measurement_journal').update({ five_plus_sequence: '11' }).eq('id', h0123.id);
        } else {
            console.log('H0123 is already 11');
        }
    } else {
        console.log('H0123 not found', errH0123);
    }
}

fixSequences();
