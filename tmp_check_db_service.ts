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

async function checkDiff() {
  const { data } = await supabase.from("measurement_journal").select("id, business_name, designated_office, measurement_year, measurement_fee_total, measurement_fee_business, measurement_fee_national");
  if (!data) return;
  for (const item of data) {
    let office = item.designated_office || "";
    if (office.includes("천안")) office = "천안";
    
    if (office === "천안") {
      let year = item.measurement_year;
      if (year && year.toString() === "2026") {
         const fee = Number(item.measurement_fee_total) || 0;
         const bFee = Number(item.measurement_fee_business) || 0;
         const nFee = Number(item.measurement_fee_national) || 0;
         
         if (fee !== bFee + nFee) {
            console.log(`[원인발견] ID: ${item.id}, 사업장: ${item.business_name}, 총액: ${fee}, (사업장+국고): ${bFee+nFee}`);
         }
      }
    }
  }
}
checkDiff();
