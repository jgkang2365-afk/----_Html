import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function retroRegister() {
  const supabase = createServerClient();

  // 1. 현재 최대 H코드 조회
  const { data: maxCode } = await supabase
    .from("measurement_target_business")
    .select("code")
    .order("code", { ascending: false })
    .limit(1)
    .single();

  let nextCodeNum = maxCode ? parseInt(maxCode.code.replace("H", "")) + 1 : 500;
  console.log(`현재 최대 코드: ${maxCode?.code}, 다음 부여 코드: H${String(nextCodeNum).padStart(4, "0")}\n`);

  // 2. 등록 대상 6건 정의 (측정일지에서 조회한 정보 활용)
  const orphans = [
    { name: "삼일공업사", address: "충청남도 천안시 서북구 수레터1길 23 (차암동, 삼일공업사2급정비공장)", category: "공업사", journalIds: [1443] },
    { name: "시온모터스", address: "대전광역시 대덕구 대화로 16, 지하층 (대화동)", category: "공업사", journalIds: [1394, 926] },
    { name: "남영물류산업 (주) 쿠팡 INC43 Ph2 Mezzanine 설치 공사", address: "인천광역시 서구 봉수대로 370 (석남동, 인천석남혁신물류센터)", category: "건설", journalIds: [1419] },
    { name: "켄직코퍼레이션 주식회사 CHA6 Conveyor공급 및 설치 공사", address: "충청남도 천안시 서북구 입장면 용정도하길 181 (용정리)", category: "건설", journalIds: [1457] },
    { name: "에이치디씨현대산업개발 주식회사 당진천안선 터널소방시설공사", address: "충청남도 아산시 영인면 토정로 148 (역리)", category: "건설", journalIds: [1085, 1484] },
    { name: "입장모터스", address: "충청남도 천안시 서북구 성거읍 모전4길 45 (모전리, 입장모터스)", category: "공업사", journalIds: [1442] },
  ];

  console.log("=== Step 1: 마스터 테이블(measurement_business) 등록 ===\n");

  const codeMap: Record<string, string> = {};

  for (const orphan of orphans) {
    const code = `H${String(nextCodeNum).padStart(4, "0")}`;
    codeMap[orphan.name] = code;

    // 마스터 테이블 등록
    const { error: masterErr } = await supabase
      .from("measurement_business")
      .upsert({
        code,
        business_name: orphan.name,
        address: orphan.address,
        business_category: orphan.category,
      }, { onConflict: "code" });

    if (masterErr) {
      console.error(`❌ [${code}] 마스터 등록 실패: ${masterErr.message}`);
    } else {
      console.log(`✅ [${code}] "${orphan.name}" 마스터 등록 완료`);
    }

    nextCodeNum++;
  }

  console.log("\n=== Step 2: 대상목록(measurement_target_business) 등록 ===\n");

  // 각 측정일지의 년도/주기별로 대상 등록
  const journalYearPeriods: Record<string, { year: number; period: string }[]> = {
    "삼일공업사": [{ year: 2026, period: "상반기" }],
    "시온모터스": [{ year: 2025, period: "상반기" }, { year: 2026, period: "상반기" }],
    "남영물류산업 (주) 쿠팡 INC43 Ph2 Mezzanine 설치 공사": [{ year: 2026, period: "상반기" }],
    "켄직코퍼레이션 주식회사 CHA6 Conveyor공급 및 설치 공사": [{ year: 2026, period: "상반기" }],
    "에이치디씨현대산업개발 주식회사 당진천안선 터널소방시설공사": [{ year: 2025, period: "하반기" }, { year: 2026, period: "상반기" }],
    "입장모터스": [{ year: 2026, period: "상반기" }],
  };

  for (const orphan of orphans) {
    const code = codeMap[orphan.name];
    const periods = journalYearPeriods[orphan.name];

    for (const yp of periods) {
      const { error: targetErr } = await supabase
        .from("measurement_target_business")
        .upsert({
          code,
          year: yp.year,
          period: yp.period,
          business_name: orphan.name,
          address: orphan.address,
          business_category: orphan.category,
          is_registered: "실시",
        }, { onConflict: "code,year,period" });

      if (targetErr) {
        console.error(`❌ [${code}] ${yp.year}/${yp.period} 대상 등록 실패: ${targetErr.message}`);
      } else {
        console.log(`✅ [${code}] "${orphan.name}" → ${yp.year}/${yp.period} 대상 등록 완료`);
      }
    }
  }

  console.log("\n=== Step 3: 측정일지(measurement_journal) business_code 연결 ===\n");

  for (const orphan of orphans) {
    const code = codeMap[orphan.name];

    for (const jId of orphan.journalIds) {
      const { error: updateErr } = await supabase
        .from("measurement_journal")
        .update({ business_code: code })
        .eq("id", jId);

      if (updateErr) {
        console.error(`❌ 일지 ID ${jId} 코드 연결 실패: ${updateErr.message}`);
      } else {
        console.log(`✅ 일지 ID ${jId} → ${code} 연결 완료`);
      }
    }
  }

  // 4. 최종 검증
  console.log("\n=== Step 4: 최종 검증 ===\n");

  const { data: verifyJournals } = await supabase
    .from("measurement_journal")
    .select("id, business_name, business_code")
    .in("id", orphans.flatMap(o => o.journalIds));

  verifyJournals?.forEach(j => {
    const status = j.business_code ? "✅" : "❌";
    console.log(`${status} 일지 ID ${j.id}: "${j.business_name}" → 코드: ${j.business_code || "없음"}`);
  });

  console.log("\n=== 부여된 코드 요약 ===\n");
  for (const orphan of orphans) {
    console.log(`[${codeMap[orphan.name]}] ${orphan.name}`);
  }
}

retroRegister().catch(console.error);
