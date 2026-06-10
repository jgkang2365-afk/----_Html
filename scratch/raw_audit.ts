
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function checkAllNumericsRaw() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const tables = ["measurement_journal", "measurement_business"];
  
  console.log("=== RAW DATA AUDIT (Numeric Categories) ===");
  
  for (const table of tables) {
    console.log(`\n--- TABLE: ${table} ---`);
    const { data, error } = await supabase
      .from(table)
      .select("code, business_name, business_category")
      .not("business_category", "is", null);
      
    if (error) {
      console.error(`Error fetching ${table}:`, error);
      continue;
    }
    
    // Filter for numeric categories in JS for maximum accuracy
    const numericRecords = data.filter(r => /^\d+$/.test(String(r.business_category)));
    
    if (numericRecords.length === 0) {
      console.log("No numeric categories found.");
    } else {
      console.log(`Found ${numericRecords.length} records with numeric categories:`);
      numericRecords.forEach(r => {
        console.log(`Code: ${r.code} | Name: ${r.business_name} | Cat: ${r.business_category}`);
      });
    }
  }
}

checkAllNumericsRaw();
