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
  if (line.trim().startsWith("NEXT_PUBLIC_SUPABASE_URL=")) {
    supabaseUrl = line.split("=")[1].trim().replace(/['"]/g, '');
  }
  if (line.trim().startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY=")) {
    supabaseKey = line.split("=")[1].trim().replace(/['"]/g, '');
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDiff() {
  const { data, error } = await supabase
    .from("measurement_journal")
    .select("id, business_name, designated_office, measurement_year, measurement_fee_total, measurement_fee_business, measurement_fee_national")
    .not("business_name", "ilike", "%번외%");
    
  if (error) {
    console.error(error);
    return;
  }
  
  let totalFee = 0;
  let totalSub = 0;
  
  for (const item of data) {
    const shortName = item.designated_office ? toShortName(item.designated_office) : "기타";
    const year = parseInt(item.measurement_year);
    if (shortName === "천안" && year === 2026) {
      const total = parseFloat(item.measurement_fee_total || 0);
      const bFee = parseFloat(item.measurement_fee_business || 0);
      const nFee = parseFloat(item.measurement_fee_national || 0);
      
      totalFee += total;
      
      // The logic in StatTables:
      if (bFee + nFee > 0) {
        totalSub += (bFee + nFee);
      }
      
      // What if the sum is 0 but total > 0?
      if (total !== bFee + nFee) {
        console.log(`Difference found at ID: ${item.id}, Name: ${item.business_name}, Total: ${total}, b+n: ${bFee+nFee}`);
      }
    }
  }
  
  console.log(`2026년 천안 측정비 1번표 합계(전체 Total): ${totalFee}`);
  console.log(`2026년 천안 측정비 2번표 합계(사업장+국고): ${totalSub}`);
}

checkDiff();
