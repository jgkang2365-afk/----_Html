
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function bulkUpdate30() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const tables = ["measurement_target_business", "measurement_journal", "measurement_business"];
  
  for (const table of tables) {
    console.log(`Processing ${table}...`);
    
    // 1. 대전특장공업 (H0182) -> 공업사
    // Note: User said "대전특정공업" but the list has "대전특장공업". I'll use code H0182 for precision.
    const { error: err1 } = await supabase
      .from(table)
      .update({ business_category: "공업사" })
      .eq("business_category", "30")
      .eq("code", "H0182");
    
    if (err1) console.error(`Error updating H0182 in ${table}:`, err1);
    else console.log(`Updated H0182 to '공업사' in ${table}`);

    // 2. Others with category 30 -> 제조
    const { error: err2 } = await supabase
      .from(table)
      .update({ business_category: "제조" })
      .eq("business_category", "30");
      
    if (err2) console.error(`Error updating others in ${table}:`, err2);
    else console.log(`Updated remaining '30' to '제조' in ${table}`);
  }
}

bulkUpdate30();
