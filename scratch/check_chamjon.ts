import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkChamjon() {
  const supabase = createServerClient();
  const queryWord = "참존";

  console.log(`=== "${queryWord}" 검색 결과 ===\n`);

  // 1. measurement_target_business 조회
  const { data: targets, error: e1 } = await supabase
    .from("measurement_target_business")
    .select("id, code, year, period, business_name, is_registered")
    .ilike("business_name", `%${queryWord}%`);

  if (e1) {
    console.error("대상 사업장 조회 에러:", e1);
  } else {
    console.log(`[measurement_target_business] (대상 사업장 테이블) - 총 ${targets?.length || 0}건`);
    targets?.forEach((t) => {
      console.log(`  - ID: ${t.id} | 코드: ${t.code} | 연도: ${t.year} | 주기: ${t.period} | 사업장명: "${t.business_name}" | 등록상태: ${t.is_registered}`);
    });
  }

  console.log("\n----------------------------------------\n");

  // 2. measurement_journal 조회
  const { data: journals, error: e2 } = await supabase
    .from("measurement_journal")
    .select("id, code, measurement_year, measurement_period, business_name, completion_status")
    .ilike("business_name", `%${queryWord}%`);

  if (e2) {
    console.error("측정 일지 조회 에러:", e2);
  } else {
    console.log(`[measurement_journal] (측정 일지 테이블) - 총 ${journals?.length || 0}건`);
    journals?.forEach((j) => {
      console.log(`  - ID: ${j.id} | 코드: ${j.code} | 연도: ${j.measurement_year} | 주기: ${j.measurement_period} | 사업장명: "${j.business_name}" | 완료상태: ${j.completion_status}`);
    });
  }
}

checkChamjon().catch(console.error);
