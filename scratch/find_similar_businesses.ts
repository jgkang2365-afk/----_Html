import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function searchSimilar() {
  const supabase = createServerClient();
  const year = 2026;

  const keywords = [
    { key: "삼일", full: "삼일공업사" },
    { key: "시온", full: "시온모터스" },
    { key: "남영", full: "남영물류산업 (주) 쿠팡 INC43 Ph2 Mezzanine 설치 공사" },
    { key: "켄직", full: "켄직코퍼레이션 주식회사 CHA6 Conveyor공급 및 설치 공사" },
    { key: "현대산업", full: "에이치디씨현대산업개발 주식회사 당진천안선 터널소방시설공사" },
    { key: "입장", full: "입장모터스" }
  ];

  console.log("=== 대상목록(measurement_target_business)에서 키워드 검색 ===\n");

  for (const item of keywords) {
    console.log(`🔎 키워드: [${item.key}] (원래 명칭: ${item.full})`);
    
    // 대상목록 검색
    const { data: targets, error: targetErr } = await supabase
      .from("measurement_target_business")
      .select("id, code, year, period, business_name, is_registered")
      .ilike("business_name", `%${item.key}%`);

    if (targetErr) {
      console.error("대상목록 검색 에러:", targetErr.message);
    } else if (targets && targets.length > 0) {
      console.log(`  -> 대상목록 유사 매칭 건수: ${targets.length}건`);
      targets.forEach(t => {
        console.log(`     [${t.code}] ${t.business_name} (${t.year}년 ${t.period}, 상태: ${t.is_registered})`);
      });
    } else {
      console.log("  -> 대상목록 유사 매칭 없음");
    }

    // 마스터 목록 검색
    const { data: businesses, error: bizErr } = await supabase
      .from("measurement_business")
      .select("code, business_name, address")
      .ilike("business_name", `%${item.key}%`);

    if (bizErr) {
      console.error("마스터목록 검색 에러:", bizErr.message);
    } else if (businesses && businesses.length > 0) {
      console.log(`  -> 마스터목록(measurement_business) 유사 매칭 건수: ${businesses.length}건`);
      businesses.forEach(b => {
        console.log(`     [${b.code}] ${b.business_name} (주소: ${b.address})`);
      });
    } else {
      console.log("  -> 마스터목록 유사 매칭 없음");
    }
    console.log("------------------------------------------------------------------\n");
  }
}

searchSimilar().catch(console.error);
