
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function absoluteFullAudit() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const targetCategories = ["건설", "제조", "공업사", "병원"];
  
  console.log("=== ABSOLUTE FULL AUDIT (All Records) ===");
  
  const { data, error } = await supabase
    .from("measurement_business")
    .select("code, business_name, business_category")
    .order("code", { ascending: true });
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  let count = 0;
  data.forEach(r => {
    const isNumeric = /^\d+$/.test(String(r.business_category));
    const isUpdated = targetCategories.includes(String(r.business_category));
    
    if (isNumeric || isUpdated) {
      count++;
      console.log(`${count}. [${r.business_category}] ${r.code} | ${r.business_name}`);
    }
  });
  
  console.log(`\nTOTAL RECORDS FOUND: ${count}`);
}

absoluteFullAudit();
