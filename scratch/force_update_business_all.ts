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

async function forceUpdateBusinessAll() {
  console.log('--- Force Updating ALL measurement_business (Paginated) ---');
  
  let offset = 0;
  const limit = 1000;
  let totalFixed = 0;
  let hasMore = true;

  while (hasMore) {
    console.log(`Fetching records from ${offset} to ${offset + limit}...`);
    const { data, error } = await supabase
      .from('measurement_business')
      .select('*')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching data:', error);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    const recordsToUpdate = data.filter(row => {
      const cat = String(row.business_category || '').trim();
      return cat !== '' && !isNaN(Number(cat)) && mapping[cat];
    });

    for (const row of recordsToUpdate) {
      const cat = String(row.business_category).trim();
      const config = mapping[cat];
      let newValue = config.default;
      if (config.overrides && config.overrides[row.business_name.trim()]) {
        newValue = config.overrides[row.business_name.trim()];
      }

      const { error: updateError } = await supabase
        .from('measurement_business')
        .update({ business_category: newValue })
        .match({ 
          code: row.code, 
          year: row.year, 
          period: row.period 
        });

      if (!updateError) {
        totalFixed++;
      } else {
        console.error(`  FAILED for ${row.code}: ${updateError.message}`);
      }
    }

    if (data.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }
  
  console.log(`Total records fixed: ${totalFixed}`);
  console.log('Force update completed.');
}

forceUpdateBusinessAll();
