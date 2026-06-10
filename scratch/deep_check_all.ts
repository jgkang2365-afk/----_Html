import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function deepCheckAllTables() {
  const tables = [
    'measurement_target_business',
    'measurement_journal',
    'measurement_business',
    'business_info',
    'measurement_summary'
  ];

  console.log('--- Deep Checking All Tables (Paginated) ---');

  for (const table of tables) {
    let offset = 0;
    const limit = 1000;
    let numericCount = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from(table)
        .select('business_category')
        .range(offset, offset + limit - 1);

      if (error) {
        if (error.code === '42P01') { // Table not found
          console.log(`Table ${table} does not exist. Skipping.`);
        } else {
          console.error(`Error checking ${table}:`, error.message);
        }
        hasMore = false;
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      const found = data.filter(row => {
        const cat = String(row.business_category || '').trim();
        return cat !== '' && !isNaN(Number(cat));
      });
      numericCount += found.length;

      if (data.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }
    console.log(`Table [${table}]: Found ${numericCount} numeric records.`);
  }
}

deepCheckAllTables();
