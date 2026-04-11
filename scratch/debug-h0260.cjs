const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  console.log('--- Target Business ---');
  const { data: targets, error: tErr } = await supabase
    .from('measurement_target_business')
    .select('code, year, period, is_registered, google_event_id, measurement_date')
    .eq('code', 'H0260');
  
  if (tErr) console.error(tErr);
  else console.log(targets);

  console.log('\n--- Preliminary Surveys ---');
  const { data: srvs, error: sErr } = await supabase
    .from('preliminary_survey')
    .select('id, year, period, measurement_date, google_event_id')
    .eq('code', 'H0260');
  
  if (sErr) console.error(sErr);
  else console.log(srvs);
}

run();
