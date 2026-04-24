
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function hunt95() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data } = await supabase.from("measurement_target_business").select("id, business_category, business_name");
  
  const matches = data?.filter(d => {
    const val = String(d.business_category).trim();
    return val === "95" || val === "95.0" || val === "095";
  });
  
  console.log("Matches for 95/95.0/095:", matches?.length);
  if (matches && matches.length > 0) {
    console.log("Sample:", matches[0]);
  }
}

hunt95();
