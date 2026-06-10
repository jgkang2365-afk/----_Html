
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function checkJournalColumns() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from("measurement_journal")
    .select("*")
    .limit(1)
    .single();

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Columns found in measurement_journal:", Object.keys(data));
  }
}

checkJournalColumns().catch(console.error);
