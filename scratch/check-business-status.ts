import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStatus() {
  const names = ["참존건설", "아이엘셀리온", "에스엠에이치"];

  for (const name of names) {
    console.log(`\n--- Checking: ${name} ---`);
    
    // 1. target_business에서 조회
    const { data: targets, error: tError } = await supabase
      .from("measurement_target_business")
      .select("*")
      .ilike("business_name", `%${name}%`);
    
    if (tError) {
      console.error(`Error fetching targets for ${name}:`, tError);
      continue;
    }

    if (!targets || targets.length === 0) {
      console.log(`No target business found for ${name}`);
      continue;
    }

    for (const target of targets) {
      console.log(`[Target] Code: ${target.code}, Name: ${target.business_name}, Year: ${target.year}, Period: ${target.period}, Registered: ${target.is_registered}, Sync: ${target.sync_status}, NationalSupport: ${target.national_support_status}`);
      
      // 2. journal에서 조회 (보고서/계산서 상태 확인)
      const { data: journals, error: jError } = await supabase
        .from("measurement_journal")
        .select("*")
        .eq("code", target.code)
        .eq("measurement_year", target.year)
        .eq("measurement_period", target.period);
      
      if (journals && journals.length > 0) {
        for (const journal of journals) {
          console.log(`  [Journal] K2B: ${journal.k2b_send_date}, Invoice: ${journal.electronic_invoice_date}, Fee: ${journal.measurement_fee_business}`);
        }
      } else {
        console.log(`  [Journal] No journal entry found.`);
      }

      // 3. preliminary_survey에서 조회 (캘린더 ID 확인)
      const { data: surveys, error: sError } = await supabase
        .from("preliminary_survey")
        .select("*")
        .eq("code", target.code)
        .eq("year", target.year)
        .eq("period", target.period);
      
      if (surveys && surveys.length > 0) {
        for (const survey of surveys) {
          console.log(`  [Survey] Date: ${survey.measurement_date}, Event ID: ${survey.google_event_id}, Writer: ${survey.report_writer}`);
        }
      } else {
        console.log(`  [Survey] No survey entry found.`);
      }
    }
  }
}

checkStatus();
