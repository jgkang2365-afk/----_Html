
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyFix() {
    const code = 'H0448';
    const year = '2026';
    const period = '상반기';

    console.log(`Verifying API response logic for ${code} ${year} ${period}`);

    // This matches the logic added to app/api/journal/previous-data/route.ts
    const { getBestReferenceData } = await import('./lib/business/reference-data');
    const referenceData = await getBestReferenceData(supabase, code, parseInt(year), period);

    console.log('\nReference Data fetched by API logic:');
    console.log(JSON.stringify(referenceData, null, 2));

    if (referenceData.business_number === '3918802936') {
        console.log('\nSUCCESS: Business number is correctly mapped in referenceData.');
    } else {
        console.log('\nFAILURE: Business number mismatch in referenceData.');
    }
}

verifyFix();
