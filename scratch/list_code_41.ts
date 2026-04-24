
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function listCode41() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  // 1. Fetch from measurement_journal
  const { data: journals } = await supabase
    .from("measurement_journal")
    .select("code, business_name, measurement_year, measurement_period")
    .eq("business_category", "41")
    .limit(50);
    
  // 2. Fetch from measurement_business (to get unique names)
  const { data: masters } = await supabase
    .from("measurement_business")
    .select("code, business_name")
    .eq("business_category", "41")
    .limit(50);

  console.log("--- Category '41' Businesses (Journal Sample) ---");
  journals?.forEach(j => console.log(`[${j.measurement_year}-${j.measurement_period}] ${j.business_name} (${j.code})`));
  
  console.log("\n--- Category '41' Businesses (Master Sample) ---");
  masters?.forEach(m => console.log(`${m.business_name} (${m.code})`));
}

listCode41();
