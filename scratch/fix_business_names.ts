import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function fixNames() {
  const supabase = createServerClient();
  const year = 2026;
  const period = "상반기";

  // 1. 양쪽 데이터 가져오기
  const { data: journals } = await supabase
    .from("measurement_journal")
    .select("id, business_name")
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${period}%`);

  const { data: targets } = await supabase
    .from("measurement_target_business")
    .select("id, business_name, code")
    .eq("year", year)
    .ilike("period", `%${period}%`);

  if (!journals || !targets) {
    console.error("데이터 조회 실패");
    return;
  }

  // 2. 정규화 함수 (공백 통일)
  const normalize = (name: string) => name.replace(/\s+/g, "").toLowerCase();

  // 3. 대상목록에서 측정일지에 매칭되지 않는 건 찾기
  const journalNames = new Set(journals.map(j => j.business_name));
  const journalNormalizedMap = new Map<string, string>();
  journals.forEach(j => {
    journalNormalizedMap.set(normalize(j.business_name), j.business_name);
  });

  const mismatches: { targetId: string; targetName: string; journalName: string; code: string }[] = [];

  targets.forEach(t => {
    if (!journalNames.has(t.business_name)) {
      // 정규화 매칭 시도
      const normalizedTarget = normalize(t.business_name);
      const matchedJournalName = journalNormalizedMap.get(normalizedTarget);
      if (matchedJournalName) {
        mismatches.push({
          targetId: t.id,
          targetName: t.business_name,
          journalName: matchedJournalName,
          code: t.code
        });
      }
    }
  });

  console.log(`=== 사업장명 불일치 매칭 결과 (${mismatches.length}건) ===\n`);
  
  if (mismatches.length === 0) {
    console.log("불일치 건이 없습니다.");
    return;
  }

  mismatches.forEach((m, i) => {
    console.log(`${i + 1}. [${m.code}]`);
    console.log(`   대상목록: "${m.targetName}"`);
    console.log(`   측정일지: "${m.journalName}"`);
    console.log();
  });

  // 4. 실제 업데이트 실행
  console.log(`\n=== 측정일지 기준으로 대상목록 사업장명 업데이트 시작 ===\n`);

  let successCount = 0;
  let failCount = 0;

  for (const m of mismatches) {
    const { error } = await supabase
      .from("measurement_target_business")
      .update({ business_name: m.journalName })
      .eq("id", m.targetId);

    if (error) {
      console.error(`❌ [${m.code}] 업데이트 실패:`, error.message);
      failCount++;
    } else {
      console.log(`✅ [${m.code}] "${m.targetName}" → "${m.journalName}"`);
      successCount++;
    }
  }

  console.log(`\n=== 완료: 성공 ${successCount}건 / 실패 ${failCount}건 ===`);

  // 5. 업데이트 후 재검증
  const { data: remainingJournals } = await supabase
    .from("measurement_journal")
    .select("business_name")
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${period}%`);

  const { data: remainingTargets } = await supabase
    .from("measurement_target_business")
    .select("business_name")
    .eq("year", year)
    .ilike("period", `%${period}%`);

  const updatedTargetNames = new Set(remainingTargets?.map(t => t.business_name) || []);
  const stillUnmatched = remainingJournals
    ?.filter(j => !j.business_name?.includes("번외") && !updatedTargetNames.has(j.business_name))
    ?.map(j => j.business_name) || [];

  const uniqueStill = [...new Set(stillUnmatched)];
  console.log(`\n=== 업데이트 후 여전히 불일치 건: ${uniqueStill.length}건 ===`);
  if (uniqueStill.length > 0) {
    uniqueStill.forEach(name => console.log(`  - ${name}`));
  }
}

fixNames().catch(console.error);
