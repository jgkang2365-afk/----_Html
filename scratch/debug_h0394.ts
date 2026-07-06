import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function checkH0394Data() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("=== Checking business_info ===");
  const { data: businessInfo, error: err1 } = await supabase
    .from("business_info")
    .select("*")
    .eq("code", "H0394");
  if (err1) console.error("Error businessInfo:", err1);
  console.log(JSON.stringify(businessInfo, null, 2));

  console.log("\n=== Checking measurement_business ===");
  const { data: measurementBusiness, error: err2 } = await supabase
    .from("measurement_business")
    .select("*")
    .eq("code", "H0394");
  if (err2) console.error("Error measurementBusiness:", err2);
  console.log(JSON.stringify(measurementBusiness, null, 2));

  console.log("\n=== Checking measurement_target_business ===");
  const { data: targetBusiness, error: err3 } = await supabase
    .from("measurement_target_business")
    .select("*")
    .eq("code", "H0394");
  if (err3) console.error("Error targetBusiness:", err3);
  console.log(JSON.stringify(targetBusiness, null, 2));
}

checkH0394Data().catch(console.error);
