import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  console.log('--- Sample Data from measurement_journal ---');
  const { data, error } = await supabase
    .from('measurement_journal')
    .select('code, office_jurisdiction, designated_office, measurement_year, sequence_number, measurement_start_date')
    .eq('measurement_year', 2026)
    .limit(10);

  if (data) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error(error);
  }
}

checkData();
