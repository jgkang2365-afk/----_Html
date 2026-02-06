
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fixJournal1153() {
    console.log('Fixing Journal ID 1153...');

    // 1. Fetch current data to be sure
    const { data: current, error: fetchError } = await supabase
        .from('measurement_journal')
        .select('*')
        .eq('id', 1153)
        .single();

    if (fetchError) {
        console.error('Fetch Error:', fetchError);
        return;
    }

    const depositBiz1 = Number(current.deposit_amount_business || 0);
    const depositBiz2 = Number(current.deposit_amount_business_2 || 0);
    // We want to force National Deposit to 0
    const newDepositNational = 0;

    // Recalculate Total
    const newTotal = depositBiz1 + depositBiz2 + newDepositNational;

    console.log(`Updating ID 1153:`);
    console.log(`- Old National Deposit: ${current.deposit_amount_national}`);
    console.log(`- New National Deposit: ${newDepositNational}`);
    console.log(`- Old Total: ${current.deposit_total}`);
    console.log(`- New Total: ${newTotal}`);

    const { data: updated, error: updateError } = await supabase
        .from('measurement_journal')
        .update({
            deposit_amount_national: newDepositNational,
            deposit_total: newTotal,
            updated_at: new Date().toISOString()
        })
        .eq('id', 1153)
        .select()
        .single();

    if (updateError) {
        console.error('Update Error:', updateError);
    } else {
        console.log('Update Successful!');
        console.log(`- New Business Unpaid: ${Number(updated.measurement_fee_business) - (Number(updated.deposit_amount_business) + Number(updated.deposit_amount_business_2))}`);
        console.log(`- New National Unpaid: ${Number(updated.measurement_fee_national) - Number(updated.deposit_amount_national)}`);
    }
}

fixJournal1153();
