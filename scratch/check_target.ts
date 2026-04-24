import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('measurement_target_business')
    .select('business_name, business_category')
    .limit(50);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('--- measurement_target_business Samples ---');
  data.forEach(row => {
    console.log(`Name: ${row.business_name} | Category: [${row.business_category}] (Type: ${typeof row.business_category})`);
  });
}

check();
