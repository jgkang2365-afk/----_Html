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
  const { data } = await supabase.from("measurement_journal").select("*");
  if (!data) return;
  for (const item of data) {
    let office = item.designated_office || "";
    if (office.includes("천안")) office = "천안";
    
    if (office === "천안") {
      let year = item.measurement_year;
      // if year is 2026
      if (year && year.toString() === "2026") {
         const fee = Number(item.measurement_fee_total) || 0;
         const bFee = Number(item.measurement_fee_business) || 0;
         const nFee = Number(item.measurement_fee_national) || 0;
         
         if (fee !== bFee + nFee) {
            console.log(`[DIFF] ID: ${item.id}, Name: ${item.business_name}, Year: ${item.measurement_year}, Total: ${fee}, b+n: ${bFee+nFee}`);
         }
      }
    }
  }
}
checkDiff();
