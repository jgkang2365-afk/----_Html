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

async function check() {
  const { data, error } = await supabase
    .from("measurement_journal")
    .select("designated_office, measurement_year, measurement_period, measurement_fee_total, deposit_total")
    .not("business_name", "ilike", "%번외%");
    
  if (error) {
    console.error(error);
    return;
  }
  
  let cheonanFee = 0;
  for (const item of data) {
    if (item.designated_office === "천안" || item.designated_office === "대전지방고용노동청 천안지청") {
      cheonanFee += item.measurement_fee_total || 0;
    }
  }
  
  console.log("천안 총 측정비:", cheonanFee);
}

check();
