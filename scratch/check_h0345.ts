import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('measurement_business')
    .select('*')
    .eq('code', 'H0345');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('--- Current Data for H0345 ---');
  console.log(JSON.stringify(data, null, 2));
}

check();
