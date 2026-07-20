import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function fixRegistration() {
  const supabase = createServerClient();

  const tempCodes = ["H0493", "H0494", "H0495", "H0496", "H0497", "H0498"];
  
  console.log("=== 1단계: 이전 턴에 잘못 생성한 임시 코드 데이터 클린업 ===");
  
  // 1. 임시 코드로 생성된 measurement_target_business 삭제
  const { error: delTargetErr } = await supabase
    .from("measurement_target_business")
    .delete()
    .in("code", tempCodes);
    
  if (delTargetErr) {
    console.error("임시 대상 데이터 삭제 실패:", delTargetErr.message);
  } else {
    console.log("임시 대상 데이터(measurement_target_business) 삭제 완료.");
  }

  // 2. 임시 코드로 생성된 measurement_business 삭제
  const { error: delMasterErr } = await supabase
    .from("measurement_business")
    .delete()
    .in("code", tempCodes);

  if (delMasterErr) {
    console.error("임시 마스터 데이터 삭제 실패:", delMasterErr.message);
  } else {
    console.log("임시 마스터 데이터(measurement_business) 삭제 완료.");
  }

  console.log("\n=== 2단계: 기존에 존재하던 진짜 마스터 코드로 매핑 데이터 준비 ===");
  
  const mapping = [
    { name: "삼일공업사", realCode: "H0438", address: "충청남도 천안시 서북구 수레터1길 23 (차암동, 삼일공업사2급정비공장)", category: "공업사", journalIds: [1443], periods: [{ year: 2026, period: "상반기" }] },
    { name: "시온모터스", realCode: "H0258", address: "대전광역시 대덕구 대화로 16, 지하층 (대화동)", category: "공업사", journalIds: [1394, 926], periods: [{ year: 2025, period: "상반기" }, { year: 2026, period: "상반기" }] },
    { name: "남영물류산업 (주) 쿠팡 INC43 Ph2 Mezzanine 설치 공사", realCode: "H0432", address: "인천광역시 서구 봉수대로 370 (석남동, 인천석남혁신물류센터)", category: "건설", journalIds: [1419], periods: [{ year: 2026, period: "상반기" }] },
    { name: "켄직코퍼레이션 주식회사 CHA6 Conveyor공급 및 설치 공사", realCode: "H0434", address: "충청남도 천안시 서북구 입장면 용정도하길 181 (용정리)", category: "건설", journalIds: [1457], periods: [{ year: 2026, period: "상반기" }] },
    { name: "에이치디씨현대산업개발 주식회사 당진천안선 터널소방시설공사", realCode: "H0398", address: "충청남도 아산시 영인면 토정로 148 (역리)", category: "건설", journalIds: [1085, 1484], periods: [{ year: 2025, period: "하반기" }, { year: 2026, period: "상반기" }] },
    { name: "입장모터스", realCode: "H0439", address: "충청남도 천안시 서북구 성거읍 모전4길 45 (모전리, 입장모터스)", category: "공업사", journalIds: [1442], periods: [{ year: 2026, period: "상반기" }] },
  ];

  console.log("\n=== 3단계: 진짜 마스터 코드로 measurement_target_business 소급 등록 ===");

  for (const item of mapping) {
    for (const yp of item.periods) {
      // 이미 존재하는지 먼저 확인
      const { data: exist } = await supabase
        .from("measurement_target_business")
        .select("id")
        .eq("code", item.realCode)
        .eq("year", yp.year)
        .eq("period", yp.period)
        .maybeSingle();

      if (exist) {
        console.log(`ℹ️ [${item.realCode}] "${item.name}" → ${yp.year}/${yp.period} 대상목록에 이미 존재하여 스킵`);
        continue;
      }

      const { error: insErr } = await supabase
        .from("measurement_target_business")
        .insert({
          code: item.realCode,
          year: yp.year,
          period: yp.period,
          business_name: item.name,
          address: item.address,
          business_category: item.category,
          is_registered: "실시"
        });

      if (insErr) {
        console.error(`❌ [${item.realCode}] 대상 등록 실패:`, insErr.message);
      } else {
        console.log(`✅ [${item.realCode}] "${item.name}" → ${yp.year}/${yp.period} 대상목록 소급 등록 완료`);
      }
    }
  }

  console.log("\n=== 4단계: 측정일지(measurement_journal) 테이블의 code(사업장코드) 연결 ===");

  for (const item of mapping) {
    for (const jId of item.journalIds) {
      const { error: updateErr } = await supabase
        .from("measurement_journal")
        .update({ code: item.realCode }) // 실제 컬럼명인 'code' 사용
        .eq("id", jId);

      if (updateErr) {
        console.error(`❌ 일지 ID ${jId} -> 코드 ${item.realCode} 연결 실패:`, updateErr.message);
      } else {
        console.log(`✅ 일지 ID ${jId} ("${item.name}") -> 코드 ${item.realCode} 연결 성공!`);
      }
    }
  }

  console.log("\n=== 5단계: 최종 무결성 교차 검증 ===");
  
  const allIds = mapping.flatMap(m => m.journalIds);
  const { data: finalJournals } = await supabase
    .from("measurement_journal")
    .select("id, business_name, code")
    .in("id", allIds);

  finalJournals?.forEach(j => {
    const isOk = j.code && !tempCodes.includes(j.code);
    console.log(`${isOk ? "✅" : "❌"} 일지 ID ${j.id}: "${j.business_name}" -> 코드: ${j.code}`);
  });
}

fixRegistration().catch(console.error);
