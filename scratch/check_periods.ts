import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkPeriods() {
  const supabase = createServerClient();
  const year = 2026;

  console.log(`=== ${year}년 period 분포 조회 ===\n`);

  // 1. measurement_target_business
  const { data: targets } = await supabase
    .from("measurement_target_business")
    .select("period, is_registered")
    .eq("year", year);

  const targetCounts: Record<string, { total: number; executed: number; ended: number }> = {};
  targets?.forEach(t => {
    const p = t.period || "null";
    if (!targetCounts[p]) targetCounts[p] = { total: 0, executed: 0, ended: 0 };
    targetCounts[p].total += 1;
    if (t.is_registered === "실시") targetCounts[p].executed += 1;
    if (t.is_registered === "거래종료" || t.is_registered === "종료") targetCounts[p].ended += 1;
  });

  console.log("[measurement_target_business]");
  console.entries = Object.entries(targetCounts).forEach(([period, c]) => {
    console.log(`  - ${period}: 전체 ${c.total}건 | 실시 ${c.executed}건 | 거래종료 ${c.ended}건 (활성: ${c.total - c.ended}건)`);
  });

  // 2. measurement_journal
  const { data: journals } = await supabase
    .from("measurement_journal")
    .select("measurement_period")
    .eq("measurement_year", year);

  const journalCounts: Record<string, number> = {};
  journals?.forEach(j => {
    const p = j.measurement_period || "null";
    journalCounts[p] = (journalCounts[p] || 0) + 1;
  });

  console.log("\n[measurement_journal]");
  Object.entries(journalCounts).forEach(([period, count]) => {
    console.log(`  - ${period}: ${count}건`);
  });
}

checkPeriods().catch(console.error);
