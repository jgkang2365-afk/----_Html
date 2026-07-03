import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkCounts() {
  const supabase = createServerClient();
  const year = 2026;
  const period = "상반기";

  console.log(`=== ${year}년 ${period} 데이터 건수 비교 ===\n`);

  // 1. measurement_journal 전체
  const { data: allJournals, error: e1 } = await supabase
    .from("measurement_journal")
    .select("id, business_name, completion_status, measurement_period")
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${period}%`);

  const totalJournal = allJournals?.length || 0;
  const bunwaeJournals = allJournals?.filter(j => j.business_name?.includes("번외")) || [];
  const journalExcluded = totalJournal - bunwaeJournals.length;
  const completeAll = allJournals?.filter(j => j.completion_status !== "미완료").length || 0;
  const completeExcluded = allJournals?.filter(j => j.completion_status !== "미완료" && !j.business_name?.includes("번외")).length || 0;

  console.log(`[measurement_journal]`);
  console.log(`  전체: ${totalJournal}건`);
  console.log(`  번외 포함: ${bunwaeJournals.length}건`);
  console.log(`  번외 제외: ${journalExcluded}건`);
  console.log(`  완료(전체): ${completeAll}건 → 완료율 ${totalJournal > 0 ? (completeAll/totalJournal*100).toFixed(1) : 0}%`);
  console.log(`  완료(번외제외): ${completeExcluded}건 → 완료율 ${journalExcluded > 0 ? (completeExcluded/journalExcluded*100).toFixed(1) : 0}%`);
  
  // 수시 포함 건수도 확인
  const susiJournals = allJournals?.filter(j => j.measurement_period?.includes("수시")) || [];
  console.log(`  수시 포함: ${susiJournals.length}건`);

  if (bunwaeJournals.length > 0) {
    console.log(`  번외 목록:`);
    bunwaeJournals.forEach(b => console.log(`    - ${b.business_name} (${b.completion_status})`));
  }

  // 2. measurement_target_business 전체 (상반기 + 상반기(수시))
  const { data: allTargets, error: e2 } = await supabase
    .from("measurement_target_business")
    .select("id, business_name, is_registered, period")
    .eq("year", year)
    .ilike("period", `%${period}%`);

  const totalTarget = allTargets?.length || 0;
  const activeTarget = allTargets?.filter(t => t.is_registered !== "거래종료").length || 0;
  const terminatedTarget = allTargets?.filter(t => t.is_registered === "거래종료").length || 0;
  const confirmedTarget = allTargets?.filter(t => t.is_registered === "실시").length || 0;

  console.log(`\n[measurement_target_business]`);
  console.log(`  전체: ${totalTarget}건`);
  console.log(`  실시: ${confirmedTarget}건`);
  console.log(`  거래종료: ${terminatedTarget}건`);
  console.log(`  거래종료 제외(활성): ${activeTarget}건`);

  // 3. 차이 분석
  console.log(`\n=== 차이 분석 ===`);
  console.log(`  측정일지(전체) ${totalJournal} vs 측정대상(전체) ${totalTarget} → 차이: ${totalJournal - totalTarget}건`);
  console.log(`  측정일지(번외제외) ${journalExcluded} vs 측정대상(활성) ${activeTarget} → 차이: ${journalExcluded - activeTarget}건`);

  // 4. 측정일지에만 있고 대상에 없는 사업장
  const targetNames = new Set(allTargets?.map(t => t.business_name?.trim()) || []);
  const journalOnly = allJournals
    ?.filter(j => !j.business_name?.includes("번외") && !targetNames.has(j.business_name?.trim()))
    ?.map(j => j.business_name) || [];
  
  const uniqueJournalOnly = [...new Set(journalOnly)];
  if (uniqueJournalOnly.length > 0) {
    console.log(`\n[측정일지에만 존재 (대상목록에 없음)] ${uniqueJournalOnly.length}건:`);
    uniqueJournalOnly.slice(0, 30).forEach(name => console.log(`  - ${name}`));
    if (uniqueJournalOnly.length > 30) console.log(`  ... 외 ${uniqueJournalOnly.length - 30}건`);
  }

  // 5. 대상에만 있고 측정일지에 없는 사업장
  const journalNames = new Set(allJournals?.map(j => j.business_name?.trim()) || []);
  const targetOnly = allTargets
    ?.filter(t => !journalNames.has(t.business_name?.trim()) && t.is_registered !== "거래종료")
    ?.map(t => `${t.business_name} (${t.is_registered || "미실시"})`) || [];

  const uniqueTargetOnly = [...new Set(targetOnly)];
  if (uniqueTargetOnly.length > 0) {
    console.log(`\n[대상목록에만 존재 (측정일지에 없음, 활성)] ${uniqueTargetOnly.length}건:`);
    uniqueTargetOnly.slice(0, 30).forEach(name => console.log(`  - ${name}`));
    if (uniqueTargetOnly.length > 30) console.log(`  ... 외 ${uniqueTargetOnly.length - 30}건`);
  }
}

checkCounts().catch(console.error);
