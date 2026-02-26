
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixData() {
    const code = 'H0448';
    const correctBizNum = '3918802936';

    console.log(`Checking business_info for ${code}...`);
    const { data: info } = await supabase.from('business_info').select('*').eq('code', code).maybeSingle();

    if (info) {
        if (!info.business_number || info.business_number === '') {
            console.log(`Updating business_number for ${code} to ${correctBizNum}...`);
            const { error: updateError } = await supabase
                .from('business_info')
                .update({ business_number: correctBizNum })
                .eq('code', code);

            if (updateError) {
                console.error('Update failed:', updateError);
            } else {
                console.log('Update successful.');
            }
        } else {
            console.log(`Business number for ${code} is already set to: ${info.business_number}`);
        }
    } else {
        console.log(`Business info for ${code} not found in business_info table.`);
    }

    // Double check measurement_business
    console.log(`\nVerifying measurement_business for ${code}...`);
    const { data: measurement } = await supabase.from('measurement_business').select('*').eq('code', code);
    if (measurement && measurement.length > 0) {
        measurement.forEach(m => {
            console.log(`- ${m.year} ${m.period}: biz_num="${m.business_number}"`);
        });
    }
}

fixData();
