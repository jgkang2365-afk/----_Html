
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function checkH0300() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase environment variables are missing.");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const code = "H0300";

  console.log(`--- Checking data for Business Code: ${code} ---`);

  // 1. Check business_info (Master Info)
  const { data: businessInfo, error: infoError } = await supabase
    .from("business_info")
    .select("code, business_name, phone, fax")
    .eq("code", code)
    .maybeSingle();

  if (infoError) console.error("Error fetching business_info:", infoError);
  console.log("\n[business_info (Master)]");
  console.log(businessInfo || "No record found.");

  // 2. Check measurement_business (Latest)
  const { data: measurementBusiness, error: mbError } = await supabase
    .from("measurement_business")
    .select("code, business_name, year, period, phone, manager_mobile")
    .eq("code", code)
    .order("year", { ascending: false })
    .order("period", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mbError) console.error("Error fetching measurement_business:", mbError);
  console.log("\n[measurement_business (Latest)]");
  console.log(measurementBusiness || "No record found.");

  // 3. Check measurement_journal (History)
  const { data: measurementJournals, error: mjError } = await supabase
    .from("measurement_journal")
    .select("code, business_name, measurement_year, measurement_period, phone, manager_mobile, created_at")
    .eq("code", code)
    .order("measurement_year", { ascending: false })
    .order("measurement_period", { ascending: false })
    .limit(5);

  if (mjError) console.error("Error fetching measurement_journal:", mjError);
  console.log("\n[measurement_journal (History)]");
  if (measurementJournals && measurementJournals.length > 0) {
    measurementJournals.forEach(mj => {
      console.log(`${mj.measurement_year} ${mj.measurement_period}: phone=${mj.phone}, mobile=${mj.manager_mobile}, created=${mj.created_at}`);
    });
  } else {
    console.log("No journals found.");
  }

  console.log("\n--- Check complete ---");
}

checkH0300().catch(console.error);
