import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function listColumns() {
    const { data, error } = await supabase.from('measurement_journal').select('*').limit(1);
    if (error) {
        console.error('Error:', error);
        return;
    }
    if (data && data[0]) {
        console.log('Columns in measurement_journal:');
        console.log(Object.keys(data[0]).sort().join(', '));
    }
}

listColumns();
