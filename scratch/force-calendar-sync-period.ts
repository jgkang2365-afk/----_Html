import { createClient } from "@supabase/supabase-js";
import { syncBusinessToCalendar } from "../lib/google/sync-service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function syncPeriod() {
  const startDate = "2026-04-24";
  const endDate = "2026-04-28";

  console.log(`[Calendar Sync] Fetching surveys between ${startDate} and ${endDate}...`);

  const { data: surveys, error } = await supabase
    .from("preliminary_survey")
    .select("code, year, period, measurement_date")
    .gte("measurement_date", startDate)
    .lte("measurement_date", endDate);

  if (error) {
    console.error("[Calendar Sync] Error fetching surveys:", error);
    return;
  }

  if (!surveys || surveys.length === 0) {
    console.log("[Calendar Sync] No surveys found for this period.");
    return;
  }

  // 중복 제거 (한 사업장이 여러 일정을 가질 수 있지만 syncBusinessToCalendar가 해당 사업장의 모든 일정을 처리하므로 code/year/period 쌍으로 유니크하게 추출)
  const uniqueBusinesses = Array.from(
    new Map(surveys.map(s => [`${s.code}-${s.year}-${s.period}`, s])).values()
  );

  console.log(`[Calendar Sync] Found ${uniqueBusinesses.length} businesses to sync.`);

  for (const biz of uniqueBusinesses) {
    console.log(`[Calendar Sync] Syncing ${biz.code} (${biz.year}/${biz.period}) - Date: ${biz.measurement_date}...`);
    try {
      const result = await syncBusinessToCalendar(supabase, biz.code, biz.year, biz.period);
      console.log(`[Calendar Sync] Success for ${biz.code}:`, result);
      
      // Rate Limit 방지를 위해 1초 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`[Calendar Sync] Failed for ${biz.code}:`, err);
    }
  }

  console.log("[Calendar Sync] Period sync completed.");
}

syncPeriod();
