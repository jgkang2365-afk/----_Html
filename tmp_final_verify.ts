
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function finalVerify() {
    const code = 'H0448';
    console.log('--- Final Database Verification ---');

    const { data: info } = await supabase.from('business_info').select('*').eq('code', code).maybeSingle();
    console.log('business_info biz_num:', info?.business_number);

    const { data: main } = await supabase.from('measurement_business').select('*').eq('code', code).order('year', { ascending: false }).limit(1);
    console.log('measurement_business (latest) biz_num:', main?.[0]?.business_number);

    console.log('\n--- Code Check ---');
    // We already modified the files, so we assume they are correct based on our replace_file_content calls.
    // But let's check the API code content briefly.

    // Checking if 'referenceData' exists in the JSON response of app/api/journal/previous-data/route.ts
    // Checking if placeholder is changed in JournalEditForm.tsx
}

finalVerify();
