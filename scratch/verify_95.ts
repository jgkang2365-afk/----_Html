
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function verify() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { count: c1 } = await supabase.from("measurement_target_business").select("*", { count: 'exact', head: true }).eq("business_category", "95");
  const { count: c2 } = await supabase.from("measurement_journal").select("*", { count: 'exact', head: true }).eq("business_category", "95");
  const { count: c3 } = await supabase.from("measurement_business").select("*", { count: 'exact', head: true }).eq("business_category", "95");
  
  console.log(`Remaining '95' -> Target: ${c1}, Journal: ${c2}, Master: ${c3}`);
  
  // Try searching for "95 " or " 95"
  const { data: fuzzy } = await supabase.from("measurement_target_business").select("id, business_category").ilike("business_category", "%95%");
  console.log("Fuzzy matches for '95':", fuzzy);
}

verify();
