import { createClient } from "@supabase/supabase-js";
import { syncBusinessToCalendar } from "../lib/google/sync-service.js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // 또는 관리자 키

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSync() {
  const code = "H0260";
  const year = 2026;
  const period = "상반기";

  console.log(`[Test] Force syncing ${code}...`);
  try {
    const result = await syncBusinessToCalendar(supabase, code, year, period);
    console.log("[Test] Result:", result);
  } catch (error) {
    console.error("[Test] Error:", error);
  }
}

testSync();
