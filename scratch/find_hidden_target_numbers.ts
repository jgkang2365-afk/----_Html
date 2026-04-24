import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findHiddenNumbers() {
  console.log('--- Intensive Search: measurement_target_business ---');
  
  let offset = 0;
  const limit = 1000;
  let hasMore = true;
  let totalFound = 0;

  while (hasMore) {
    const { data, error } = await supabase
      .from('measurement_target_business')
      .select('code, business_name, business_category, year, period')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error:', error.message);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    const numericRecords = data.filter(row => {
      const cat = String(row.business_category || '').trim();
      // 숫자로만 이루어져 있거나 숫자가 포함된 경우 모두 체크
      return cat !== '' && !isNaN(Number(cat));
    });

    if (numericRecords.length > 0) {
      totalFound += numericRecords.length;
      console.log(`Found ${numericRecords.length} records in range ${offset}-${offset + limit}`);
      numericRecords.slice(0, 3).forEach(r => {
        console.log(`  - ${r.business_name} (${r.code}): [${r.business_category}]`);
      });
    }

    if (data.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  console.log(`\nTotal numeric records in measurement_target_business: ${totalFound}`);
}

findHiddenNumbers();
