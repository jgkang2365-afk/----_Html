/**
 * 특정 사업장의 국고지원 상태 확인 스크립트
 * 사용법: npx tsx scripts/check-national-support.ts "사업장명"
 */

import { createClient } from "../lib/supabase/server";

async function checkNationalSupport(businessName: string) {
  const supabase = await createClient();

  console.log(`\n🔍 "${businessName}" 사업장의 국고지원 상태 확인 중...\n`);

  // 1. business_info에서 코드 찾기
  const { data: businessInfo, error: businessInfoError } = await supabase
    .from("business_info")
    .select("code, business_name")
    .ilike("business_name", `%${businessName}%`);

  if (businessInfoError) {
    console.error("❌ 사업장정보 조회 오류:", businessInfoError);
    return;
  }

  if (!businessInfo || businessInfo.length === 0) {
    console.log(`❌ "${businessName}" 사업장을 찾을 수 없습니다.`);
    return;
  }

  console.log(`✅ 찾은 사업장 (${businessInfo.length}개):`);
  businessInfo.forEach((b: any) => {
    console.log(`   - 코드: ${b.code}, 사업장명: ${b.business_name}`);
  });

  const codes = businessInfo.map((b: any) => b.code);

  // 2. national_support_application에서 국고지원 상태 확인
  const { data: nationalSupportData, error: nationalSupportError } = await supabase
    .from("national_support_application")
    .select("code, year, period, application_status, result, national_support_status")
    .in("code", codes)
    .order("year", { ascending: false })
    .order("period", { ascending: false });

  if (nationalSupportError) {
    console.error("❌ 건강디딤돌 신청결과 조회 오류:", nationalSupportError);
  } else if (nationalSupportData && nationalSupportData.length > 0) {
    console.log(`\n📋 건강디딤돌 신청결과 (${nationalSupportData.length}건):`);
    nationalSupportData.forEach((item: any) => {
      console.log(`   - ${item.year}년 ${item.period}: ${item.national_support_status || "(없음)"}`);
      console.log(`     신청 여부: ${item.application_status || "-"}, 신청결과: ${item.result || "-"}`);
    });
  } else {
    console.log("\n⚠️  건강디딤돌 신청결과가 없습니다.");
  }

  // 3. measurement_journal에서 국고지원 상태 확인
  const { data: journalData, error: journalError } = await supabase
    .from("measurement_journal")
    .select("code, measurement_year, measurement_period, national_support_status, business_name")
    .in("code", codes)
    .order("measurement_year", { ascending: false })
    .order("measurement_period", { ascending: false });

  if (journalError) {
    console.error("❌ 측정일지 조회 오류:", journalError);
  } else if (journalData && journalData.length > 0) {
    console.log(`\n📝 측정일지의 국고지원 상태 (${journalData.length}건):`);
    journalData.forEach((item: any) => {
      console.log(`   - ${item.measurement_year}년 ${item.measurement_period}: ${item.national_support_status || "(없음)"}`);
    });
  } else {
    console.log("\n⚠️  측정일지가 없습니다.");
  }

  // 4. measurement_target_business에서 국고지원 상태 확인
  const { data: targetBusinessData, error: targetBusinessError } = await supabase
    .from("measurement_target_business")
    .select("code, year, period, national_support_status")
    .in("code", codes)
    .order("year", { ascending: false })
    .order("period", { ascending: false });

  if (targetBusinessError) {
    console.error("❌ 측정 대상 사업장 조회 오류:", targetBusinessError);
  } else if (targetBusinessData && targetBusinessData.length > 0) {
    console.log(`\n📊 측정 대상 사업장의 국고지원 상태 (${targetBusinessData.length}건):`);
    targetBusinessData.forEach((item: any) => {
      console.log(`   - ${item.year}년 ${item.period}: ${item.national_support_status || "(없음)"}`);
    });
  } else {
    console.log("\n⚠️  측정 대상 사업장 데이터가 없습니다.");
  }

  console.log("\n✅ 확인 완료!\n");
}

// 스크립트 실행
const businessName = process.argv[2];
if (!businessName) {
  console.error("사용법: npx tsx scripts/check-national-support.ts \"사업장명\"");
  console.error('예시: npx tsx scripts/check-national-support.ts "한반도1급자동차공업사"');
  process.exit(1);
}

checkNationalSupport(businessName).catch((error) => {
  console.error("❌ 오류 발생:", error);
  process.exit(1);
});
