import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkDiscrepancies3() {
  const supabase = createServerClient();
  const year = 2026;
  const period = "상반기";

  // 1. measurement_journal 전체 조회
  const { data: allJournals } = await supabase
    .from("measurement_journal")
    .select("business_name, code")
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${period}%`);

  const journalNames = new Set(allJournals?.map(j => j.business_name?.trim()) || []);
  const journalCodes = new Set(allJournals?.map(j => j.code?.trim()) || []);

  // 2. measurement_target_business 전체 조회
  const { data: allTargets } = await supabase
    .from("measurement_target_business")
    .select("business_name, code, is_registered, period")
    .eq("year", year)
    .ilike("period", `%${period}%`);

  console.log("=== 대상에는 있으나 일지에는 없는 건 (상세 분석) ===");
  const targetOnly = allTargets?.filter(t => t.is_registered !== "거래종료" && !journalNames.has(t.business_name?.trim()));
  targetOnly?.forEach(t => {
    console.log(`  - Code: ${t.code} | Name: "${t.business_name}" | Status: ${t.is_registered} | Period: ${t.period}`);
    // 해당 코드가 일지 테이블에는 존재하는지 조회
    const hasCodeInJournal = journalCodes.has(t.code?.trim());
    console.log(`    -> 이 코드(${t.code})가 일지에 존재합니까? ${hasCodeInJournal ? "예" : "아니오"}`);
  });

  console.log("\n=== 일지에는 있으나 대상에는 없는 건 (상세 분석) ===");
  const targetNames = new Set(allTargets?.map(t => t.business_name?.trim()) || []);
  const journalOnly = allJournals?.filter(j => !j.business_name?.includes("번외") && !targetNames.has(j.business_name?.trim()));
  journalOnly?.forEach(j => {
    console.log(`  - Code: ${j.code} | Name: "${j.business_name}"`);
  });
}

checkDiscrepancies3().catch(console.error);
