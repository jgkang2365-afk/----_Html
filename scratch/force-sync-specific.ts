import { createClient } from "@supabase/supabase-js";
import { syncBusinessToCalendar } from "../lib/google/sync-service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function syncSpecific() {
  const targets = [
    { code: "H0284", year: 2026, period: "상반기" }, // 정안레미콘
    { code: "H0150", year: 2026, period: "상반기" }  // (주)한마
  ];

  for (const target of targets) {
    console.log(`[Calendar Sync] Force syncing ${target.code} (${target.year}/${target.period})...`);
    try {
      const result = await syncBusinessToCalendar(supabase, target.code, target.year, target.period);
      console.log(`[Calendar Sync] Result for ${target.code}:`, result);
    } catch (err) {
      console.error(`[Calendar Sync] Failed for ${target.code}:`, err);
    }
  }
}

syncSpecific();
