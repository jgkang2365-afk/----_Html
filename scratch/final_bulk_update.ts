
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function finalUpdate() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  console.log("Updating measurement_business (Master)...");
  const { error, count } = await supabase
    .from("measurement_business")
    .update({ business_category: "공업사" })
    .eq("business_category", "95")
    .select();
    
  if (error) {
    console.error("Error updating master:", error);
  } else {
    console.log(`Successfully updated master records.`);
  }

  // Also check target business one more time just in case
  const { error: error2 } = await supabase
    .from("measurement_target_business")
    .update({ business_category: "공업사" })
    .eq("business_category", "95")
    .select();
  
  console.log(`Updated target records.`);
}

finalUpdate();
