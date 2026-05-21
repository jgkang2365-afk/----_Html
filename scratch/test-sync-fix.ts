import { createClient } from "@supabase/supabase-js";
import { syncBusinessSchedule } from "../lib/utils/survey-sync";

const SUPABASE_URL = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzUyMzE5OSwiZXhwIjoyMDgzMDk5MTk5fQ.JjQ6jjPlCV1GE93_rM3F6pGr1ZaN3phuwo4iRiprML8"; // service role key

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testSync() {
  const code = "H0406";
  const year = 2026;
  const period = "상반기";

  console.log(`[Test] Running syncBusinessSchedule for ${code} (${year} ${period})...`);
  
  // 1. 동기화 실행 전 일지(Journal) 정보 조회
  const { data: journalBefore } = await supabase
    .from("measurement_journal")
    .select("measurer")
    .eq("code", code)
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${period}%`);
  
  console.log("Journal measurer before sync:", journalBefore?.[0]?.measurer);

  // 2. 동기화 수행 (우리가 고친 survey-sync 로직 작동)
  await syncBusinessSchedule(supabase, code, year, period);

  // 3. 동기화 실행 후 일지(Journal) 정보 조회
  const { data: journalAfter } = await supabase
    .from("measurement_journal")
    .select("measurer")
    .eq("code", code)
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${period}%`);

  console.log("Journal measurer after sync:", journalAfter?.[0]?.measurer);

  if (journalAfter?.[0]?.measurer === "이태환") {
    console.log("🎉 SUCCESS: Sync logic correctly updated journal measurer with preliminary survey's measurer (이태환)!");
  } else {
    console.error("❌ FAILURE: Sync logic did not update with '이태환'. Got:", journalAfter?.[0]?.measurer);
  }
}

testSync();
