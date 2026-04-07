import { createClient } from "@supabase/supabase-js";
import fs from "fs";

let supabaseUrl = "";
let supabaseKey = "";
const env = fs.readFileSync(".env.local", "utf-8");
for (const line of env.split("\n")) {
  if (line.trim().startsWith("NEXT_PUBLIC_SUPABASE_URL=")) supabaseUrl = line.split("=")[1].trim().replace(/['"]/g, '');
  if (line.trim().startsWith("SUPABASE_SERVICE_ROLE_KEY=")) supabaseKey = line.split("=")[1].trim().replace(/['"]/g, '');
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function find600k() {
  const { data } = await supabase.from("measurement_journal").select("id, business_name, designated_office, measurement_year, measurement_fee_total").in("id", [849, 898, 1113, 1117]);
  console.log(data);
}
find600k();
