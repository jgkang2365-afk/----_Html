
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function fetchRealList() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  console.log("=== REAL DB DATA (Code H0001 - H0100) ===");
  
  const { data, error } = await supabase
    .from("measurement_business")
    .select("code, business_name, business_category")
    .ilike("code", "H00%")
    .order("code", { ascending: true });
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  if (data) {
    data.forEach(r => {
      console.log(`Code: ${r.code} | Name: ${r.business_name} | Cat: ${r.business_category}`);
    });
  } else {
    console.log("No records found.");
  }
}

fetchRealList();
