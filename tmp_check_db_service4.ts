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

export const DESIGNATED_OFFICE_FULL_NAME_TO_SHORT: Record<string, string> = {
  "대전지방고용노동청 천안지청": "천안",
  "대전지방고용노동청": "대전",
  "중부지방고용노동청 평택지청": "평택",
  "중부지방고용노동청 경기지청": "경기",
  "중부지방고용노동청 영월지청": "영월",
};

export function oldToShortName(fullName: string): string {
  if (!fullName) return "";
  const trimmedName = fullName.trim();
  if (DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName]) return DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName];
  // THE OLD REGEX !!
  const jicheongMatch = fullName.match(/^.*\s+(.+)지청$/);
  if (jicheongMatch && jicheongMatch[1]) return jicheongMatch[1];
  const cheongMatch = fullName.match(/^(.+)지방고용노동청$/);
  if (cheongMatch && cheongMatch[1]) return cheongMatch[1];
  return fullName;
}

export function newToShortName(fullName: string): string {
  if (!fullName) return "";
  const trimmedName = fullName.trim();
  if (DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName]) return DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName];
  // THE NEW REGEX !!
  const jicheongMatch = fullName.match(/(?:.*\s+)?(.+)지청$/);
  if (jicheongMatch && jicheongMatch[1]) return jicheongMatch[1];
  const cheongMatch = fullName.match(/^(.+)지방고용노동청$/);
  if (cheongMatch && cheongMatch[1]) return cheongMatch[1];
  return fullName;
}

async function checkLogicDiff() {
  const { data } = await supabase.from("measurement_journal").select("id, business_name, designated_office, measurement_year, measurement_fee_total");
  if (!data) return;
  
  let oldSum = 0;
  let newSum = 0;
  let oldItems = [];
  let newItems = [];
  
  for (const item of data) {
    if (item.measurement_year !== 2026) continue;
    
    const fee = Number(item.measurement_fee_total) || 0;
    const oldName = item.designated_office ? oldToShortName(item.designated_office) : "기타";
    const newName = item.designated_office ? newToShortName(item.designated_office) : "기타";
    
    if (oldName === "천안") {
      oldSum += fee;
      oldItems.push({id: item.id, designated_office: item.designated_office});
    }
    
    if (newName === "천안") {
      newSum += fee;
      newItems.push({id: item.id, designated_office: item.designated_office});
    }
    
    if ((oldName === "천안") !== (newName === "천안")) {
       console.log(`[Diff] ID:${item.id}, DB:${item.designated_office}, Old->${oldName}, New->${newName}, Fee:${fee}`);
    }
  }
  
  console.log(`Old Sum for 천안: ${oldSum}`);
  console.log(`New Sum for 천안: ${newSum}`);
  console.log(`Difference: ${oldSum - newSum}`);
}
checkLogicDiff();
