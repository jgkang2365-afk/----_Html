import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// env.local 환경 변수 파일 로드
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetSyncStatus() {
  const codes = ["H0464", "H0468", "H0479"];
  const year = 2026;
  const period = "상반기";

  console.log(`=== [진행] 3개 사업장 동기화 상태(sync_status) 초기화 시작 ===`);
  
  for (const code of codes) {
    console.log(`\n대상 사업장 코드: ${code}`);
    
    const { data: before, error: selectErr } = await supabase
      .from("measurement_target_business")
      .select("id, business_name, sync_status")
      .eq("code", code)
      .eq("year", year)
      .eq("period", period)
      .single();

    if (selectErr || !before) {
      console.error(`- 조회 실패:`, selectErr?.message || "데이터 없음");
      continue;
    }

    console.log(`- 초기화 전 상태: ${before.business_name} (Sync: ${before.sync_status})`);

    const { error: updateErr } = await supabase
      .from("measurement_target_business")
      .update({ sync_status: null, sync_error_message: null })
      .eq("id", before.id);

    if (updateErr) {
      console.error(`- 초기화 실패:`, updateErr.message);
    } else {
      console.log(`- 초기화 완료 (sync_status를 null로 변경함)`);
    }
  }

  console.log(`\n=== [완료] 초기화 프로세스 종료 ===`);
}

resetSyncStatus().catch(console.error);
