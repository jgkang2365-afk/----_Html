import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkRemaining() {
  const supabase = createServerClient();
  const year = 2026;

  const remaining = [
    "삼일공업사", "시온모터스",
    "남영물류산업 (주) 쿠팡 INC43 Ph2 Mezzanine 설치 공사",
    "(주)참존건설 쿠팡 CHA6 FC 대수선공사",
    "켄직코퍼레이션 주식회사 CHA6 Conveyor공급 및 설치 공사",
    "그린자동차정비공업 주식회사",
    "중부모터스(주)렉서스천안아산",
    "에이치디씨현대산업개발 주식회사 당진천안선 터널소방시설공사",
    "입장모터스"
  ];

  console.log(`=== 측정일지에만 존재하는 9건 상세 분석 ===\n`);

  for (const name of remaining) {
    // 측정일지에서 상세 정보 조회
    const { data: journal } = await supabase
      .from("measurement_journal")
      .select("id, business_name, measurement_period, measurement_year, completion_status, measurement_start_date, business_code")
      .eq("measurement_year", year)
      .eq("business_name", name)
      .limit(1)
      .single();

    // 대상목록에서 유사 검색 (이름 일부)
    const shortName = name.substring(0, 4);
    const { data: similarTargets } = await supabase
      .from("measurement_target_business")
      .select("id, business_name, code, period, is_registered")
      .eq("year", year)
      .ilike("business_name", `%${shortName}%`);

    console.log(`■ "${name}"`);
    console.log(`  측정일지: 주기=${journal?.measurement_period}, 코드=${journal?.business_code || "없음"}, 상태=${journal?.completion_status}, 시작일=${journal?.measurement_start_date || "-"}`);
    
    if (similarTargets && similarTargets.length > 0) {
      console.log(`  대상목록 유사 검색 결과:`);
      similarTargets.forEach(t => {
        console.log(`    → [${t.code}] "${t.business_name}" (${t.period}, ${t.is_registered})`);
      });
    } else {
      console.log(`  대상목록 유사 검색: 결과 없음`);
    }
    console.log();
  }
}

checkRemaining().catch(console.error);
