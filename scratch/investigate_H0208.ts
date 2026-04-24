
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function investigateH0208() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  console.log("--- Investigating Code H0208 ---");
  
  // 1. measurement_journal
  const { data: journals } = await supabase
    .from("measurement_journal")
    .select("business_name, business_category")
    .eq("code", "H0208");
  console.log("measurement_journal data:", journals);
  
  // 2. measurement_business (Master)
  const { data: masters } = await supabase
    .from("measurement_business")
    .select("business_name, business_category")
    .eq("code", "H0208");
  console.log("measurement_business (Master) data:", masters);
  
  // 3. business_info (The one in user's screenshot)
  const { data: info } = await supabase
    .from("business_info")
    .select("business_name, business_category")
    .eq("code", "H0208");
  console.log("business_info data:", info);

  // 4. measurement_target_business
  const { data: targets } = await supabase
    .from("measurement_target_business")
    .select("business_name, business_category")
    .eq("code", "H0208");
  console.log("measurement_target_business data:", targets);
}

investigateH0208();
