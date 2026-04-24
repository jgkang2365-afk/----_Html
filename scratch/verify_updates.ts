
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function verifyUpdates() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const targetCategories = ["건설", "제조", "공업사", "병원"];
  const tables = ["measurement_journal", "measurement_business"];
  
  console.log("=== FINAL VERIFICATION AUDIT (Current Status) ===");
  
  for (const cat of targetCategories) {
    console.log(`\n\n### [CATEGORY: ${cat}] ###`);
    
    for (const table of tables) {
      console.log(`\n--- Table: ${table} ---`);
      const { data, error } = await supabase
        .from(table)
        .select("code, business_name")
        .eq("business_category", cat);
        
      if (error) {
        console.error(`Error fetching ${table}:`, error);
        continue;
      }
      
      if (!data || data.length === 0) {
        console.log("No records found.");
      } else {
        // Unique entries to reduce noise
        const unique = Array.from(new Set(data.map(r => `${r.code} | ${r.business_name}`))).sort();
        console.log(`Found ${unique.length} unique businesses:`);
        unique.forEach(u => console.log(u));
      }
    }
  }
}

verifyUpdates();
