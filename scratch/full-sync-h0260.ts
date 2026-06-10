import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { syncBusinessToCalendar } from '../lib/google/sync-service';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fullSyncH0260() {
  const code = 'H0260';
  const year = 2026;
  const period = '상반기';

  console.log(`[Full Sync] Correcting preliminary_survey for ${code}...`);

  // 1. 4/22 일정에 강종구 추가
  const { error: surveyError } = await supabase
    .from("preliminary_survey")
    .update({ actual_measurer: "한기문, 고유빈, 강종구" })
    .eq("code", code)
    .eq("year", year)
    .eq("period", period)
    .eq("measurement_date", "2026-04-22");

  if (surveyError) {
    console.error("Survey Update Error:", surveyError);
    return;
  }

  // 2. 캘린더 동기화 트리거
  console.log(`[Full Sync] Triggering Google Calendar Sync...`);
  const result = await syncBusinessToCalendar(supabase, code, year, period);
  
  console.log("[Full Sync] Result:", result);
}

fullSyncH0260();
