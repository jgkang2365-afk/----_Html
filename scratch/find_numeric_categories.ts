import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findNumericCategories() {
  const tables = ['measurement_target_business', 'measurement_journal', 'measurement_business'];
  const summary: Record<string, Record<string, number>> = {};

  for (const table of tables) {
    console.log(`\n--- Checking table: ${table} ---`);
    // id가 없을 수 있으므로 전체 조회 후 필터링 (데이터 양이 아주 많지 않다고 가정)
    const { data, error } = await supabase
      .from(table)
      .select('code, business_name, business_category');

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      continue;
    }

    if (!data) continue;

    summary[table] = {};
    const numericRecords = data.filter(row => {
      const val = String(row.business_category || '').trim();
      if (val !== '' && !isNaN(Number(val))) {
        summary[table][val] = (summary[table][val] || 0) + 1;
        return true;
      }
      return false;
    });

    console.log(`Found ${numericRecords.length} numeric records.`);
    
    if (Object.keys(summary[table]).length > 0) {
      console.log('Value Distribution:');
      console.table(summary[table]);
      
      // 샘플 출력 (각 숫자값별로 최대 3개씩)
      const uniqueNums = Object.keys(summary[table]);
      console.log('\nSamples:');
      for (const num of uniqueNums) {
        const samples = numericRecords.filter(r => String(r.business_category).trim() === num).slice(0, 3);
        console.log(`[Value: ${num}]`);
        samples.forEach(s => console.log(`  - Code: ${s.code} | Name: ${s.business_name}`));
      }
    }
  }
}

findNumericCategories();
