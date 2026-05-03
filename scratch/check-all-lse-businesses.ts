import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllBusinesses() {
    const { data: businesses, error } = await supabase
        .from('measurement_business')
        .select('*')
        .ilike('business_name', '%엘에스이%');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${businesses.length} total business records for '엘에스이'`);
    businesses.forEach(b => {
        console.log(`ID: ${b.id} | Code: ${b.code} | Name: ${b.business_name} | Year: ${b.year} | Period: ${b.period}`);
    });
}

checkAllBusinesses();
