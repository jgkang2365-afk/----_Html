
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function inspectJournal1153() {
    console.log('Inspecting Journal ID 1153...');

    const { data, error } = await supabase
        .from('measurement_journal')
        .select('*')
        .eq('id', 1153)
        .single();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Journal 1153 Data:');
        console.log(`- Fee Total: ${data.measurement_fee_total}`);
        console.log(`- Fee Business: ${data.measurement_fee_business}`);
        console.log(`- Fee National: ${data.measurement_fee_national}`);
        console.log(`- Deposit Total: ${data.deposit_total}`);
        console.log(`- Deposit Biz 1: ${data.deposit_amount_business}`);
        console.log(`- Deposit Biz 2: ${data.deposit_amount_business_2}`);
        console.log(`- Deposit National: ${data.deposit_amount_national}`);
        console.log(`- Created: ${data.created_at}`);
        console.log(`- Updated: ${data.updated_at}`);
    }
}

inspectJournal1153();
