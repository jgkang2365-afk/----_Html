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

async function dryRunUpdate() {
  const tables = ['measurement_target_business', 'measurement_journal', 'measurement_business'];
  let report = '# Dry-run Report: business_category Data Correction\n\n';
  report += `Date: ${new Date().toLocaleString()}\n\n`;

  for (const table of tables) {
    console.log(`Processing ${table}...`);
    const { data, error } = await supabase
      .from(table)
      .select('code, business_name, business_category');

    if (error) {
      report += `## Table: ${table}\n- Error: ${error.message}\n\n`;
      continue;
    }

    const updates: any[] = [];
    data?.forEach(row => {
      const cat = String(row.business_category || '').trim();
      if (cat !== '' && !isNaN(Number(cat)) && mapping[cat]) {
        const config = mapping[cat];
        let newValue = config.default;
        if (config.overrides && config.overrides[row.business_name.trim()]) {
          newValue = config.overrides[row.business_name.trim()];
        }
        updates.push({
          code: row.code,
          name: row.business_name,
          oldValue: cat,
          newValue: newValue
        });
      }
    });

    report += `## Table: ${table} (Total: ${updates.length} items)\n\n`;
    if (updates.length > 0) {
      report += '| Code | Business Name | Old (Code) | New (Category) |\n';
      report += '| :--- | :--- | :--- | :--- |\n';
      updates.forEach(u => {
        report += `| ${u.code} | ${u.name} | ${u.oldValue} | **${u.newValue}** |\n`;
      });
    } else {
      report += '- No numeric data found.\n';
    }
    report += '\n';
  }

  const reportPath = path.resolve(process.cwd(), 'scratch', 'dry_run_report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`Dry-run report generated at: ${reportPath}`);
}

dryRunUpdate();
