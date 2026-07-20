import { createAdminClient } from "../lib/supabase/admin";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function queryNationalSupport() {
  const supabase = createAdminClient();

  console.log("=== 건강디딤돌 신청결과 테이블 (national_support_application) 주기 현황 ===");
  const { data: appData, error: appError } = await supabase
    .from("national_support_application")
    .select("year, period, count")
    .select("year, period");

  if (appError) {
    console.error("신청결과 조회 오류:", appError);
  } else if (appData) {
    const counts: Record<string, number> = {};
    appData.forEach(row => {
      const key = `${row.year}년 - ${row.period}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    console.log(counts);
  }

  console.log("\n=== 측정 대상 사업장 테이블 (measurement_target_business) 국고지원/주기 현황 ===");
  const { data: targetData, error: targetError } = await supabase
    .from("measurement_target_business")
    .select("year, period, national_support_status");

  if (targetError) {
    console.error("대상 사업장 조회 오류:", targetError);
  } else if (targetData) {
    const counts: Record<string, number> = {};
    targetData.forEach(row => {
      const key = `${row.year}년 - ${row.period} (국고: ${row.national_support_status})`;
      counts[key] = (counts[key] || 0) + 1;
    });
    console.log(counts);
  }
}

queryNationalSupport().catch(console.error);
