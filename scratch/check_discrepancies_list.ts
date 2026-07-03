import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function analyzeDiscrepancies() {
  const supabase = createServerClient();
  const year = 2026;
  const period = "상반기";

  console.log(`=== 2026년 ${period} 상태 불일치 정밀 분석 ===\n`);

  // 1. 측정 대상 사업장 전체 조회
  const { data: targets } = await supabase
    .from("measurement_target_business")
    .select("code, business_name, is_registered")
    .eq("year", year)
    .ilike("period", `%${period}%`);

  // 2. 측정일지 전체 조회
  const { data: journals } = await supabase
    .from("measurement_journal")
    .select("code, business_name, completion_status")
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${period}%`);

  const targetMap = new Map<string, { name: string; status: string }>();
  targets?.forEach(t => {
    if (t.code) targetMap.set(t.code, { name: t.business_name || "", status: t.is_registered || "미실시" });
  });

  const journalMap = new Map<string, { name: string; status: string }>();
  journals?.forEach(j => {
    if (j.code) journalMap.set(j.code, { name: j.business_name || "", status: j.completion_status || "미완료" });
  });

  // 케이스 1: 대상에서는 '실시'인데 일지에서는 '미완료'인 경우 (작업은 끝났으나 수납/전송 등이 덜 됨)
  const case1: any[] = [];
  targets?.forEach(t => {
    if (!t.code) return;
    const j = journalMap.get(t.code);
    if (t.is_registered === "실시" && (!j || j.status === "미완료")) {
      case1.push({ code: t.code, name: t.business_name, targetStatus: t.is_registered, journalStatus: j ? j.status : "없음" });
    }
  });

  // 케이스 2: 대상에서는 '미실시'인데 일지에서는 '완료'인 경우 (수납/전송 등은 끝났으나 대상 관리에 반영이 안 됨)
  const case2: any[] = [];
  targets?.forEach(t => {
    if (!t.code) return;
    const j = journalMap.get(t.code);
    if (t.is_registered !== "실시" && j && j.status === "완료") {
      case2.push({ code: t.code, name: t.business_name, targetStatus: t.is_registered || "미실시", journalStatus: j.status });
    }
  });

  console.log(`[분석 결과]`);
  console.log(`1. 대상 관리에서는 '실시'이나 측정일지는 '미완료' (돈 안받았거나 K2B 미전송 등): ${case1.length}건`);
  case1.slice(0, 15).forEach(c => {
    console.log(`   - [${c.code}] ${c.name} (대상: ${c.targetStatus} | 일지: ${c.journalStatus})`);
  });
  if (case1.length > 15) console.log(`   ... 외 ${case1.length - 15}건`);

  console.log(`\n2. 대상 관리에서는 '미실시'이나 측정일지는 '완료' (일지 완료 상태이나 대상 동기화 누락): ${case2.length}건`);
  case2.slice(0, 15).forEach(c => {
    console.log(`   - [${c.code}] ${c.name} (대상: ${c.targetStatus} | 일지: ${c.journalStatus})`);
  });
  if (case2.length > 15) console.log(`   ... 외 ${case2.length - 15}건`);
}

analyzeDiscrepancies().catch(console.error);
