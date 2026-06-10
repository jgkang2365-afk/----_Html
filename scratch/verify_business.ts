import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
  const { data, error } = await supabase
    .from('measurement_business')
    .select('code, business_name, business_category, year, period')
    .limit(1000);

  if (error) {
    console.error('Error:', error);
    return;
  }

  const numericRecords = data.filter(row => {
    const cat = String(row.business_category || '').trim();
    return cat !== '' && !isNaN(Number(cat));
  });

  console.log(`Found ${numericRecords.length} numeric records in measurement_business.`);
  if (numericRecords.length > 0) {
    console.log('Sample numeric records:');
    console.log(numericRecords.slice(0, 10));
  }
}

verify();
