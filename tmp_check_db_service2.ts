import { createClient } from "@supabase/supabase-js";
import fs from "fs";

export const DESIGNATED_OFFICE_FULL_NAME_TO_SHORT: Record<string, string> = {
  "대전지방고용노동청 천안지청": "천안",
  "대전지방고용노동청": "대전",
  "중부지방고용노동청 평택지청": "평택",
  "중부지방고용노동청 경기지청": "경기",
  "중부지방고용노동청 영월지청": "영월",
};

export function toShortName(fullName: string): string {
  if (!fullName) return "";
  const trimmedName = fullName.trim();
  if (DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName]) return DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName];
  const jicheongMatch = fullName.match(/(?:.*\s+)?(.+)지청$/);
  if (jicheongMatch && jicheongMatch[1]) return jicheongMatch[1];
  const cheongMatch = fullName.match(/^(.+)지방고용노동청$/);
  if (cheongMatch && cheongMatch[1]) return cheongMatch[1];
  return fullName;
}

let supabaseUrl = "";
let supabaseKey = "";
const env = fs.readFileSync(".env.local", "utf-8");
for (const line of env.split("\n")) {
  if (line.trim().startsWith("NEXT_PUBLIC_SUPABASE_URL=")) supabaseUrl = line.split("=")[1].trim().replace(/['"]/g, '');
  if (line.trim().startsWith("SUPABASE_SERVICE_ROLE_KEY=")) supabaseKey = line.split("=")[1].trim().replace(/['"]/g, '');
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDiff() {
  const { data } = await supabase.from("measurement_journal").select("id, business_name, designated_office, measurement_year, measurement_period, measurement_fee_total, measurement_fee_business, measurement_fee_national, deposit_amount_business, deposit_amount_business_2, deposit_amount_national");
  
  if (!data) return;
  
  let table1Sum = 0;
  let table2Sum = 0;
  
  for (const item of data) {
    if (!item.designated_office) continue;
    const shortName = toShortName(item.designated_office);
    
    // Exact filtering like React component
    if (shortName === "천안" && item.measurement_year === 2026) {
      // Table 1 sum logic
      const fee = Number(item.measurement_fee_total) || 0;
      table1Sum += fee;
      
      // Table 2 sum logic
      const bFee = Number(item.measurement_fee_business) || 0;
      const bDep = (Number(item.deposit_amount_business) || 0) + (Number(item.deposit_amount_business_2) || 0);
      const nFee = Number(item.measurement_fee_national) || 0;
      const nDep = Number(item.deposit_amount_national) || 0;
      
      if (bFee + nFee > 0 || bDep + nDep > 0) {
         table2Sum += (bFee + nFee);
      }
      
      if (fee !== (bFee + nFee)) {
         console.log(`[Mismatch Row] ID: ${item.id}, Name: ${item.business_name}, Fee: ${fee}, b+n: ${bFee+nFee}`);
      } else if (fee > 0 && (bFee + nFee) === 0 && (bDep + nDep) === 0) {
         console.log(`[Skipped Row] ID: ${item.id}, Name: ${item.business_name}, Fee: ${fee}`);
      }
    }
  }
  
  console.log(`\nTable 1 (측정비 총액 합산): ${table1Sum}`);
  console.log(`Table 2 (사업장+국고 조건 합산): ${table2Sum}`);
  console.log(`차이: ${table1Sum - table2Sum}`);
}
checkDiff();
