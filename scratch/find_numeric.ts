
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function findNumeric() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data } = await supabase.from("measurement_target_business").select("id, business_category");
  
  const numeric = data?.filter(d => d.business_category && /^\d+$/.test(String(d.business_category)));
  console.log("Numeric Categories in measurement_target_business:", numeric);
  
  const matches95 = data?.filter(d => String(d.business_category).trim() === "95");
  console.log("Total '95' in measurement_target_business:", matches95?.length);
}

findNumeric();
