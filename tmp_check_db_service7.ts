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

async function findNegative() {
  const { data } = await supabase.from("measurement_journal").select("id, business_name, designated_office, measurement_fee_total, measurement_year");
  if (!data) return;
  
  for (const item of data) {
     const fee = Number(item.measurement_fee_total);
     if (fee < 0) {
        console.log(`[Negative] ID: ${item.id}, Name: ${item.business_name}, Office: ${item.designated_office}, Fee: ${fee}`);
     }
  }
}
findNegative();
