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

async function lookAround() {
  const { data } = await supabase.from("measurement_journal").select("id, business_name, designated_office, measurement_year, measurement_fee_total").order("id", { ascending: false }).limit(200);
  if (!data) return;
  
  let oldSum = 0;
  for (const item of data) {
    if (item.measurement_year === 2026 && item.designated_office === "천안") {
       console.log(`- ${item.business_name} : ${item.measurement_fee_total}`);
       oldSum += item.measurement_fee_total;
    }
  }
  console.log("2026 천안 Sum:", oldSum);
  
  const { data: audit } = await supabase.from("measurement_journal").select("*").eq("measurement_year", 2026);
  // Just seeing if there's any deleted or weird records
}
lookAround();
