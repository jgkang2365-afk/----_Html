import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const mappingPath = path.resolve(process.cwd(), 'scratch', 'category_mapping.json');
const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

async function forceUpdateBusiness() {
  console.log('--- Force Updating measurement_business ---');
  
  // 1. Get ALL records
  const { data, error } = await supabase
    .from('measurement_business')
    .select('*');

  if (error) {
    console.error('Error fetching data:', error);
    return;
  }

  const recordsToUpdate = data?.filter(row => {
    const cat = String(row.business_category || '').trim();
    return cat !== '' && !isNaN(Number(cat)) && mapping[cat];
  }) || [];

  console.log(`Found ${recordsToUpdate.length} numeric records to fix.`);

  for (const row of recordsToUpdate) {
    const cat = String(row.business_category).trim();
    const config = mapping[cat];
    let newValue = config.default;
    if (config.overrides && config.overrides[row.business_name.trim()]) {
      newValue = config.overrides[row.business_name.trim()];
    }

    console.log(`Updating ${row.business_name} (${row.code}, ${row.year}, ${row.period}): ${cat} -> ${newValue}`);

    // Update using multiple keys to be absolutely sure
    const { error: updateError } = await supabase
      .from('measurement_business')
      .update({ business_category: newValue })
      .match({ 
        code: row.code, 
        year: row.year, 
        period: row.period 
      });

    if (updateError) {
      console.error(`  FAILED: ${updateError.message}`);
    } else {
      console.log(`  SUCCESS`);
    }
  }
  
  console.log('Force update completed.');
}

forceUpdateBusiness();
