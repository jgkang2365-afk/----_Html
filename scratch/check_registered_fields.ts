import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkFields() {
  const supabase = createServerClient();
  const year = 2026;

  console.log(`=== ${year}년 target 데이터 전체 조회 ===`);

  const { data: list, error } = await supabase
    .from("measurement_target_business")
    .select("business_name, is_registered, is_registered_text, period")
    .eq("year", year);

  if (error) {
    console.error("조회 에러:", error);
    return;
  }

  console.log(`총 조회 건수: ${list?.length || 0}건`);

  const countByRegistered: Record<string, number> = {};
  const countByRegisteredText: Record<string, number> = {};

  list?.forEach(item => {
    const period = item.period || "";
    if (!period.includes("상반기") || period.includes("(수시)")) return; // 수시 제외 상반기만 필터링

    const reg = item.is_registered || "null";
    const regText = item.is_registered_text || "null";

    countByRegistered[reg] = (countByRegistered[reg] || 0) + 1;
    countByRegisteredText[regText] = (countByRegisteredText[regText] || 0) + 1;
  });

  console.log("\n=== is_registered 분포 ===");
  Object.entries(countByRegistered).forEach(([key, val]) => {
    console.log(`  - ${key}: ${val}건`);
  });

  console.log("\n=== is_registered_text 분포 ===");
  Object.entries(countByRegisteredText).forEach(([key, val]) => {
    console.log(`  - ${key}: ${val}건`);
  });
}

checkFields().catch(console.error);
