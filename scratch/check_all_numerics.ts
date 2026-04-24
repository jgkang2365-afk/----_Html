
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function checkAllNumerics() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const tables = ["measurement_target_business", "measurement_journal", "measurement_business"];
  const results: any = {};

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("business_category");
    if (error) {
      results[table] = `Error: ${error.message}`;
      continue;
    }
    
    const numericMap: any = {};
    data?.forEach(d => {
      const val = String(d.business_category || "").trim();
      if (val && /^\d+$/.test(val)) {
        numericMap[val] = (numericMap[val] || 0) + 1;
      }
    });
    
    results[table] = numericMap;
  }

  console.log("Numeric Category Summary across DB:");
  console.log(JSON.stringify(results, null, 2));
}

checkAllNumerics();
