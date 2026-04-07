import { createClient } from "https://esm.sh/@supabase/supabase-js";
import fs from "fs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    if (line.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = line.split("=")[1].trim();
    }
    if (line.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY=")) {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = line.split("=")[1].trim();
    }
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function checkDiff() {
  const { data, error } = await supabase
    .from("measurement_journal")
    .select("id, business_name, designated_office, measurement_fee_total, measurement_fee_business, measurement_fee_national")
    .not("business_name", "ilike", "%번외%");
    
  if (error) {
    console.error(error);
    return;
  }
  
  let diffRecords = [];
  
  for (const item of data) {
    // Only check Cheonan
    if (item.designated_office === "천안" || item.designated_office === "대전지방고용노동청 천안지청" || item.designated_office === "천안지청") {
      const total = item.measurement_fee_total || 0;
      const bFee = item.measurement_fee_business || 0;
      const nFee = item.measurement_fee_national || 0;
      
      if (total !== bFee + nFee) {
        diffRecords.push({
          id: item.id,
          business_name: item.business_name,
          total: total,
          business_fee: bFee,
          national_fee: nFee,
          diff: total - (bFee + nFee)
        });
      }
    }
  }
  
  console.log("차이가 나는 사업장 목록:", diffRecords);
  console.log("총 차이 금액:", diffRecords.reduce((acc, curr) => acc + curr.diff, 0));
}

checkDiff();
