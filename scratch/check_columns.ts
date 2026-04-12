import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
  const { data, error } = await supabase.rpc('get_table_info', { table_name: 'measurement_business' });
  
  if (error) {
    console.error("Error fetching columns:", error);
    // fallback if RPC doesn't exist
    const { data: cols, error: err } = await supabase.from('measurement_business').select().limit(1);
    if (err) console.error("Error fetching data:", err);
    else console.log("Columns:", Object.keys(cols[0] || {}));
  } else {
    console.log("Columns Info:", data);
  }
}

checkColumns();
