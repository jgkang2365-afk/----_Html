
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function globalSearch() {
    const targetName = '천안삼일자동차종합정비공장';
    const tables = ['business_info', 'measurement_business', 'measurement_target_business', 'measurement_journal', 'preliminary_survey'];

    console.log(`Searching for "${targetName}" in all tables...`);

    for (const table of tables) {
        // We'll search in all text columns. For simplicity, we'll check business_name and address.
        const columns = table === 'preliminary_survey' ? ['business_name', 'address'] : ['business_name', 'address'];

        for (const col of columns) {
            const { data } = await supabase.from(table).select('*').ilike(col, `%${targetName}%`);
            if (data && data.length > 0) {
                console.log(`\nFound in ${table} (column: ${col}):`);
                data.forEach(row => {
                    console.log(` - Code: ${row.code || row.id}, Name: ${row.business_name}, Year: ${row.measurement_year || row.year}`);
                });
            }
        }
    }

    // Also search for the business number 3058641481 (H0004) to see if it's linked to H0448 anywhere.
    console.log('\nSearching for business number 3058641481...');
    for (const table of ['business_info', 'measurement_business', 'measurement_journal']) {
        const { data } = await supabase.from(table).select('*').eq('business_number', '3058641481');
        if (data && data.length > 0) {
            console.log(`Found in ${table}:`, data.map(d => ({ code: d.code, name: d.business_name })));
        }
    }
}

globalSearch();
