
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findBusinesses() {
    console.log('Searching for "천안삼일"...');
    const { data: byName } = await supabase
        .from("measurement_business")
        .select("*")
        .ilike('business_name', '%천안삼일%');
    console.log('Results by Name:', byName);

    console.log('\nSearching for businesses with code H0448 in different tables...');
    const { data: info } = await supabase.from('business_info').select('*').eq('code', 'H0448').maybeSingle();
    console.log('business_info H0448:', info);

    const { data: measurement } = await supabase.from('measurement_business').select('*').eq('code', 'H0448');
    console.log('measurement_business H0448:', measurement);
}

findBusinesses();
