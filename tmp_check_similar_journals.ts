
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSimilarJournals() {
    const code = 'H0448';
    console.log(`Checking for journals with code similar to ${code}`);

    // Use ILIKE to find case-insensitive and potentially with spaces
    const { data: journals, error } = await supabase
        .from('measurement_journal')
        .select('id, code, measurement_year, measurement_period, document_number')
        .ilike('code', `%${code}%`);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Found journals:');
        if (journals && journals.length > 0) {
            journals.forEach(j => console.log(`ID: ${j.id}, Code: "${j.code}" (len: ${j.code.length}), Year: ${j.measurement_year}, Period: ${j.measurement_period}, Doc: ${j.document_number}`));
        } else {
            console.log('No similar journals found.');
        }
    }
}

checkSimilarJournals();
