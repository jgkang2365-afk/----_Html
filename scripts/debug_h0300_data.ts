
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function checkH0300Data() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Checking measurement_business for H0300, 2026 상반기...");
  const { data, error } = await supabase
    .from("measurement_business")
    .select("code, year, period, phone, fax, total_employees")
    .eq("code", "H0300")
    .eq("year", 2026)
    .maybeSingle();

  if (error) console.error("Error:", error);
  console.log("Data found:", data);
}

checkH0300Data().catch(console.error);
