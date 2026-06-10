import { createClient } from "@supabase/supabase-js";
import { syncBusinessToCalendar } from "../lib/google/sync-service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAndSync() {
  const names = ["오다금속", "대승금속", "경인단조", "현대자동차충청", "천공엔지니어링"];

  for (const name of names) {
    console.log(`\n--- Processing: ${name} ---`);
    
    // 1. target_business에서 조회
    const { data: targets, error: tError } = await supabase
      .from("measurement_target_business")
      .select("*")
      .ilike("business_name", `%${name}%`)
      .eq("year", 2026);
    
    if (tError) {
      console.error(`Error fetching targets for ${name}:`, tError);
      continue;
    }

    if (!targets || targets.length === 0) {
      console.log(`No target business found for ${name}`);
      continue;
    }

    for (const target of targets) {
      console.log(`[Target] Code: ${target.code}, Name: ${target.business_name}, Status: ${target.is_registered}`);
      
      // 2. journal에서 상태 확인
      const { data: journals } = await supabase
        .from("measurement_journal")
        .select("*")
        .eq("code", target.code)
        .eq("measurement_year", target.year)
        .eq("measurement_period", target.period);
      
      if (journals && journals.length > 0) {
        const j = journals[0];
        console.log(`  [Journal] K2B: ${j.k2b_send_date}, Invoice: ${j.electronic_invoice_date}`);
      }

      // 3. 동기화 실행
      console.log(`  [Sync] Force syncing...`);
      try {
        const result = await syncBusinessToCalendar(supabase, target.code, target.year, target.period);
        console.log(`  [Sync] Result:`, result);
      } catch (err) {
        console.error(`  [Sync] Failed:`, err);
      }
      
      // Delay for Rate Limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

checkAndSync();
