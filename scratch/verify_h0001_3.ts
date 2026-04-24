
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function verifySpecificCodes() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const targetCodes = ["H0001", "H0002", "H0003"];
  const tables = ["measurement_journal", "measurement_business", "measurement_target_business"];
  
  console.log("=== SPECIFIC CODE VERIFICATION (H0001, H0002, H0003) ===");
  
  for (const code of targetCodes) {
    console.log(`\n>>> CHECKING CODE: ${code}`);
    for (const table of tables) {
      const { data, error } = await supabase
        .from(table)
        .select("business_name, business_category")
        .eq("code", code);
        
      if (error) {
        console.error(`Error in ${table}:`, error);
      } else if (data && data.length > 0) {
        console.log(`[Table: ${table}] Found:`, data);
      } else {
        console.log(`[Table: ${table}] Not found.`);
      }
    }
  }
}

verifySpecificCodes();
