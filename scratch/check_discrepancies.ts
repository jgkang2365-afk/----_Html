import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkDiscrepancies() {
  const supabase = createServerClient();
  const searchWords = ["그린자동차", "중부모터스", "태전자동차"];

  console.log("=== 불일치 사업장 정밀 조회 ===\n");

  for (const word of searchWords) {
    console.log(`>>> 검색 키워드: "${word}"`);

    // 1. measurement_target_business 조회
    const { data: targets, error: e1 } = await supabase
      .from("measurement_target_business")
      .select("id, code, year, period, business_name, is_registered")
      .ilike("business_name", `%${word}%`);

    console.log(`  [measurement_target_business] - ${targets?.length || 0}건 검색됨`);
    targets?.forEach(t => {
      console.log(`    - Code: ${t.code} | Year: ${t.year} | Period: ${t.period} | Name: "${t.business_name}" | Status: ${t.is_registered}`);
    });

    // 2. measurement_journal 조회
    const { data: journals, error: e2 } = await supabase
      .from("measurement_journal")
      .select("id, code, measurement_year, measurement_period, business_name, completion_status")
      .ilike("business_name", `%${word}%`);

    console.log(`  [measurement_journal] - ${journals?.length || 0}건 검색됨`);
    journals?.forEach(j => {
      console.log(`    - Code: ${j.code} | Year: ${j.measurement_year} | Period: ${j.measurement_period} | Name: "${j.business_name}" | Status: ${j.completion_status}`);
    });

    console.log("\n----------------------------------------\n");
  }
}

checkDiscrepancies().catch(console.error);
