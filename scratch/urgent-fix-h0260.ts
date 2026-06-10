import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { syncBusinessToCalendar } from '../lib/google/sync-service';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function urgentFixH0260() {
  const code = 'H0260';
  const year = 2026;
  const period = '상반기';

  console.log(`[Urgent Fix] Aligning data for ${code} with user's screenshot...`);

  // 1. preliminary_survey 데이터 교정 (강종구 제거, 한기문/고유빈만 유지)
  await supabase
    .from("preliminary_survey")
    .update({ actual_measurer: "한기문, 고유빈" })
    .eq("code", code)
    .eq("year", year)
    .eq("period", period);

  // 2. target_business 데이터 교정 (이미지 속 상태로 맞춤)
  await supabase
    .from("measurement_target_business")
    .update({ 
      collaborators: "고유빈",
      daily_staff: [
        { date: '2026-04-21', measurer_id: 17, collaborators: ['고유빈'] },
        { date: '2026-04-22', measurer_id: 17, collaborators: ['고유빈'] }
      ]
    })
    .eq("code", code)
    .eq("year", year)
    .eq("period", period);

  // 3. 캘린더 강제 재동기화
  console.log(`[Urgent Fix] Triggering Full Resync...`);
  await syncBusinessToCalendar(supabase, code, year, period);
  
  console.log("[Urgent Fix] Completed.");
}

urgentFixH0260();
