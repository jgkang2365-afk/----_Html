
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function deepSearch() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const targetCodes = ["H0004", "H0056", "H0069"];
  const tables = ["measurement_business", "measurement_journal", "measurement_target_business"];
  
  console.log("=== DEEP SEARCH RESULT (Table by Table) ===");
  
  for (const table of tables) {
    console.log(`\n--- Table: ${table} ---`);
    const { data, error } = await supabase
      .from(table)
      .select("code, business_name, business_category")
      .in("code", targetCodes);
      
    if (error) {
      console.error(`Error in ${table}:`, error.message);
    } else if (data && data.length > 0) {
      data.forEach((r, i) => {
        console.log(`${i+1}. [${r.code}] Name: ${r.business_name} | Cat: ${r.business_category}`);
      });
    } else {
      console.log("No records found in this table.");
    }
  }
}

deepSearch();
