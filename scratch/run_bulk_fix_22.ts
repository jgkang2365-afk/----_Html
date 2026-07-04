import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runBulkFix22() {
  const targetCodes = [
    "H0448", "H0459", "H0471", "H0488", "H0475", "H0484", "H0480", "H0074", 
    "H0450", "H0464", "H0473", "H0481", "H0461", "H0279", "H0437", "H0470", 
    "H0479", "H0469", "H0478", "H0468", "H0446", "H0439"
  ];

  console.log(`=== 22개 오류 의심 사업장 일괄 정보 보정 & 연동 시작 (대상 수: ${targetCodes.length}건) ===\n`);

  // 1. business_info 조회 (대표자명 마스터)
  const { data: bInfos } = await supabase
    .from("business_info")
    .select("code, representative_name")
    .in("code", targetCodes);
  const bInfoMap = new Map<string, string>();
  if (bInfos) {
    bInfos.forEach((bi: any) => {
      if (bi.representative_name) bInfoMap.set(bi.code, bi.representative_name);
    });
  }

  // 2. measurement_business 조회 (대표자명, 산재번호, 개시번호 실적 마스터)
  const { data: mBusinesses } = await supabase
    .from("measurement_business")
    .select("code, representative_name, industrial_accident_number, commencement_number")
    .in("code", targetCodes)
    .order("year", { ascending: false }); // 최신 실적 우선

  const mbMap = new Map<string, { representative_name: string | null, industrial_accident_number: string | null, commencement_number: string | null }>();
  if (mBusinesses) {
    mBusinesses.forEach((mb: any) => {
      if (!mbMap.has(mb.code)) {
        mbMap.set(mb.code, {
          representative_name: mb.representative_name || null,
          industrial_accident_number: mb.industrial_accident_number || null,
          commencement_number: mb.commencement_number || null
        });
      }
    });
  }

  // 3. 2026년 상반기 계획 데이터 조회
  const { data: targets } = await supabase
    .from("measurement_target_business")
    .select("*")
    .in("code", targetCodes)
    .eq("year", 2026)
    .eq("period", "상반기");

  if (!targets || targets.length === 0) {
    console.log("보정할 계획 대상 데이터를 찾지 못했습니다.");
    return;
  }

  let fixCount = 0;

  for (const target of targets) {
    const code = target.code;
    const mbFallback = mbMap.get(code) || { representative_name: null, industrial_accident_number: null, commencement_number: null };
    const biRepName = bInfoMap.get(code) || null;

    // 마스터 정보를 기반으로 대표자명, 산재번호, 개시번호 보정
    const finalRepName = target.representative_name || mbFallback.representative_name || biRepName || null;
    const finalSanjae = target.industrial_accident_number || mbFallback.industrial_accident_number || null;
    const finalCommencement = target.commencement_number || mbFallback.commencement_number || null;

    // 3-1. plans 테이블 정보 업데이트 (국고지원여부 = '대상')
    const { error: targetUpdateErr } = await supabase
      .from("measurement_target_business")
      .update({
        national_support_status: "대상",
        representative_name: finalRepName,
        industrial_accident_number: finalSanjae,
        commencement_number: finalCommencement,
        updated_at: new Date().toISOString()
      })
      .eq("id", target.id);

    if (targetUpdateErr) {
      console.error(`[오류] ${target.business_name} plans 업데이트 실패:`, targetUpdateErr.message);
      continue;
    }

    // 3-2. 건강디딤돌 신청결과 테이블(national_support_application)에 자동 Upsert 연동
    const { error: appUpsertErr } = await supabase
      .from("national_support_application")
      .upsert({
        code: target.code,
        year: 2026,
        period: "상반기",
        application_status: "○", // 기본 신청 여부 '○' 기호 지정
        result: "대상",
        national_support_status: "대상"
      }, {
        onConflict: "code,year,period",
        ignoreDuplicates: false
      });

    if (appUpsertErr) {
      console.error(`[오류] ${target.business_name} 건강디딤돌 신청결과 연동 실패:`, appUpsertErr.message);
    } else {
      console.log(`[성공] 보정 완료: ${target.business_name} (${code}) -> 대표자: ${finalRepName || '-'}, 산재: ${finalSanjae || '-'}`);
      fixCount++;
    }
  }

  console.log(`\n=== 보정 작업 완료 (총 ${fixCount}개 업체 정상 보정 및 건강디딤돌 자동 적재 완료) ===`);
}

runBulkFix22();
