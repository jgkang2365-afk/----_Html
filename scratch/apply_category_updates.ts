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

async function applyUpdates() {
  const tables = ['measurement_journal', 'measurement_business'];
  
  for (const table of tables) {
    console.log(`\n--- Updating table: ${table} ---`);
    
    // 1. Get all numeric records
    const { data, error } = await supabase
      .from(table)
      .select('*');

    if (error) {
      console.error(`Error fetching ${table}:`, error);
      continue;
    }

    const recordsToUpdate = data?.filter(row => {
      const cat = String(row.business_category || '').trim();
      return cat !== '' && !isNaN(Number(cat)) && mapping[cat];
    }) || [];

    console.log(`Found ${recordsToUpdate.length} records to update in ${table}.`);

    let successCount = 0;
    for (const row of recordsToUpdate) {
      const cat = String(row.business_category).trim();
      const config = mapping[cat];
      let newValue = config.default;
      if (config.overrides && config.overrides[row.business_name.trim()]) {
        newValue = config.overrides[row.business_name.trim()];
      }

      // Perform update by ID or Code
      const query = supabase.from(table).update({ business_category: newValue });
      if (row.id) {
        query.eq('id', row.id);
      } else {
        query.eq('code', row.code);
      }
      
      const { error: updateError } = await query;

      if (updateError) {
        console.error(`Failed to update ${table} ID ${row.id}:`, updateError.message);
      } else {
        successCount++;
      }
    }
    console.log(`Successfully updated ${successCount} records in ${table}.`);
  }
  console.log('\nAll updates completed.');
}

applyUpdates();
