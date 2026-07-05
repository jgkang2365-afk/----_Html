import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import { syncMeasurementBusiness } from "../lib/sync/excel-sync";

// env.local 로드
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log("=== 수정된 동기화 함수(syncMeasurementBusiness) 검증 시작 ===");
  console.log("대상 파일: measurement-business/measurement-business-2026-07-05T11-31-35.xlsx");

  // 동기화 실행
  const result = await syncMeasurementBusiness(
    undefined, 
    "measurement-business/measurement-business-2026-07-05T11-31-35.xlsx", 
    supabase
  );

  console.log("\n=== 동기화 실행 결과 ===");
  console.log(`성공 여부: ${result.success}`);
  console.log(`처리 건수: ${result.records_processed}`);
  console.log(`추가 건수 (신규): ${result.records_inserted}`);
  console.log(`수정 건수: ${result.records_updated}`);
  console.log(`에러 메시지: ${result.error_message || "없음"}`);
  console.log(`\n변경 로그 내역 (총 ${result.change_log?.length || 0}건):`);
  
  if (result.change_log && result.change_log.length > 0) {
    result.change_log.forEach((log) => {
      console.log(`- ${log}`);
    });
  } else {
    console.log("- 없음 (기존 데이터와 동일하거나 중복 메시지 제외됨)");
  }
}

main().catch(err => {
  console.error("실행 중 오류 발생:", err);
});
