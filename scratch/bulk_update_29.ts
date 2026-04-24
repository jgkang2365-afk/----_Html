
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function bulkUpdate29() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const tables = ["measurement_target_business", "measurement_journal", "measurement_business"];
  
  for (const table of tables) {
    console.log(`Updating ${table} (29 -> 제조)...`);
    // Lint 오류 방지를 위해 select() 인자 없이 호출
    const { error } = await supabase
      .from(table)
      .update({ business_category: "제조" })
      .eq("business_category", "29");
      
    if (error) {
      console.error(`Error updating ${table}:`, error);
    } else {
      console.log(`Successfully requested update in ${table}.`);
    }
  }
}

bulkUpdate29();
