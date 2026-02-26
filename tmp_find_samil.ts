
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findSamil() {
    console.log('Searching for "삼일" in business_info...');
    const { data: info } = await supabase
        .from("business_info")
        .select("*")
        .ilike('business_name', '%삼일%');
    console.log('Results in business_info:', info);

    console.log('\nSearching for "삼일" in measurement_business...');
    const { data: measurement } = await supabase
        .from("measurement_business")
        .select("*")
        .ilike('business_name', '%삼일%');
    console.log('Results in measurement_business:', measurement);
}

findSamil();
