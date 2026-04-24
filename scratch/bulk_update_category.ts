
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8";

async function bulkUpdate() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  // 1. Count targets with category '95'
  const { data: targets, error: tError } = await supabase
    .from("measurement_target_business")
    .select("id, code, year, period")
    .eq("business_category", "95");
    
  if (tError) {
    console.error("Error fetching targets:", tError);
    return;
  }
  
  console.log(`Found ${targets?.length || 0} records in measurement_target_business with category '95'`);
  
  if (!targets || targets.length === 0) {
    console.log("No records to update.");
  } else {
    // Perform updates on measurement_target_business
    console.log("Updating measurement_target_business...");
    const { error: up1 } = await supabase
      .from("measurement_target_business")
      .update({ business_category: "공업사" })
      .eq("business_category", "95");
      
    if (up1) console.error("Error updating targets:", up1);
    else console.log("Successfully updated measurement_target_business");
  }

  // 2. Update journals
  const { data: journals } = await supabase.from("measurement_journal").select("id").eq("business_category", "95");
  console.log(`Found ${journals?.length || 0} journals to update.`);
  if (journals && journals.length > 0) {
    const { error: up2 } = await supabase
      .from("measurement_journal")
      .update({ business_category: "공업사" })
      .eq("business_category", "95");
    if (up2) console.error("Error updating journals:", up2);
    else console.log("Successfully updated measurement_journal");
  }

  // 3. Update master
  const { data: masters } = await supabase.from("measurement_business").select("id").eq("business_category", "95");
  console.log(`Found ${masters?.length || 0} master records to update.`);
  if (masters && masters.length > 0) {
    const { error: up3 } = await supabase
      .from("measurement_business")
      .update({ business_category: "공업사" })
      .eq("business_category", "95");
    if (up3) console.error("Error updating master:", up3);
    else console.log("Successfully updated measurement_business");
  }
}

bulkUpdate();
