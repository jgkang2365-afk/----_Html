import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function investigate() {
  const supabase = createServerClient();

  const suspects = [
    "삼일공업사",
    "시온모터스",
    "남영물류산업 (주) 쿠팡 INC43 Ph2 Mezzanine 설치 공사",
    "켄직코퍼레이션 주식회사 CHA6 Conveyor공급 및 설치 공사",
    "에이치디씨현대산업개발 주식회사 당진천안선 터널소방시설공사",
    "입장모터스"
  ];

  console.log("=== 미등록 6건 측정일지 전체 컬럼 정밀 조사 ===\n");

  for (const name of suspects) {
    // 측정일지에서 모든 컬럼 조회 (년도 무관)
    const { data: journals, error } = await supabase
      .from("measurement_journal")
      .select("*")
      .eq("business_name", name);

    if (!journals || journals.length === 0) {
      console.log(`■ "${name}" → 측정일지에서 조회 안 됨 (???)`);
      continue;
    }

    for (const j of journals) {
      console.log(`■ "${name}"`);
      console.log(`  ID: ${j.id}`);
      console.log(`  사업장코드: ${j.business_code || "없음"}`);
      console.log(`  측정년도: ${j.measurement_year}`);
      console.log(`  측정주기: ${j.measurement_period}`);
      console.log(`  완료상태: ${j.completion_status}`);
      console.log(`  측정시작일: ${j.measurement_start_date || "-"}`);
      console.log(`  측정종료일: ${j.measurement_end_date || "-"}`);
      console.log(`  생성일: ${j.created_at}`);
      console.log(`  수정일: ${j.updated_at || "-"}`);
      console.log(`  측정수수료: ${j.measurement_fee_total || 0}`);
      console.log(`  K2B상태: ${j.k2b_status || "-"}`);
      console.log(`  소재지: ${j.address || "-"}`);
      console.log(`  업종: ${j.business_category || "-"}`);
      console.log();
    }
  }

  // 추가로: 예비조사(survey) 테이블에도 있는지 확인
  console.log("=== 예비조사(survey) 테이블 존재 여부 ===\n");
  for (const name of suspects) {
    const { data: surveys } = await supabase
      .from("preliminary_survey")
      .select("id, business_name, measurement_year, measurement_period, created_at")
      .eq("business_name", name);

    if (surveys && surveys.length > 0) {
      surveys.forEach(s => {
        console.log(`✔ "${name}" → 예비조사 존재 (ID:${s.id}, ${s.measurement_year}/${s.measurement_period}, 생성:${s.created_at})`);
      });
    } else {
      console.log(`✘ "${name}" → 예비조사 없음`);
    }
  }
}

investigate().catch(console.error);
