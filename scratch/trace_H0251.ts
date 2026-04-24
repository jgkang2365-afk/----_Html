
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function traceH0251() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const tables = ["measurement_journal", "measurement_business", "measurement_target_business", "business_info"];
  
  console.log("=== EMERGENCY TRACE: H0251 ===");
  
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("code", "H0251");
      
    if (error) {
      console.error(`Error in ${table}:`, error.message);
    } else if (data && data.length > 0) {
      console.log(`\n[Table: ${table}] Found ${data.length} records:`);
      data.forEach((r, i) => {
        console.log(`${i+1}. Name: ${r.business_name} | Cat: ${r.business_category} | Original Cat (if any): ${r.original_category || 'N/A'}`);
      });
    } else {
      console.log(`[Table: ${table}] No records found.`);
    }
  }
}

traceH0251();
