import { createClient } from "@supabase/supabase-js";
import fs from "fs";

let supabaseUrl = "";
let supabaseKey = "";
const env = fs.readFileSync(".env.local", "utf-8");
for (const line of env.split("\n")) {
  if (line.trim().startsWith("NEXT_PUBLIC_SUPABASE_URL=")) supabaseUrl = line.split("=")[1].trim().replace(/['"]/g, '');
  if (line.trim().startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY=")) supabaseKey = line.split("=")[1].trim().replace(/['"]/g, '');
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDiff() {
  const { data } = await supabase.from("measurement_journal").select("id, business_name, designated_office, measurement_year, measurement_fee_total, measurement_fee_business, measurement_fee_national").limit(1).eq("designated_office", "천안");
  if (data && data.length > 0) {
    const i = data[0];
    console.log(typeof i.measurement_fee_total, typeof i.measurement_fee_business, typeof i.measurement_fee_national);
    console.log(i);
  }
}
checkDiff();
