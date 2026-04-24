
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function checkJournals() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data } = await supabase.from("measurement_journal").select("business_category").limit(10);
  console.log("Journal Categories (Sample):", data);
  
  const { count } = await supabase.from("measurement_journal").select("*", { count: 'exact', head: true }).eq("business_category", "95");
  console.log("Remaining '95' in measurement_journal:", count);

  const { count: countGong } = await supabase.from("measurement_journal").select("*", { count: 'exact', head: true }).eq("business_category", "공업사");
  console.log("Total '공업사' in measurement_journal:", countGong);
}

checkJournals();
