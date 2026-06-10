import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function getAllUniqueNamesByNumericCategory() {
  const tables = ['measurement_target_business', 'measurement_journal', 'measurement_business'];
  const mapping: Record<string, Set<string>> = {};

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('business_name, business_category');

    if (error) continue;
    if (!data) continue;

    data.forEach(row => {
      const cat = String(row.business_category || '').trim();
      if (cat !== '' && !isNaN(Number(cat))) {
        if (!mapping[cat]) mapping[cat] = new Set();
        if (row.business_name) {
          mapping[cat].add(row.business_name.trim());
        }
      }
    });
  }

  // Convert Set to sorted Array
  const result: Record<string, string[]> = {};
  Object.keys(mapping).sort((a, b) => Number(a) - Number(b)).forEach(cat => {
    result[cat] = Array.from(mapping[cat]).sort();
  });

  console.log(JSON.stringify(result, null, 2));
}

getAllUniqueNamesByNumericCategory();
