import * as dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { syncBusinessInfo } from "../lib/sync/excel-sync";

// .env.local 로드
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("오류: SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

// 서비스 역할(Service Role) 권한으로 Supabase 클라이언트 생성
const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function testSync() {
  console.log("--------------------------------------------------");
  console.log("사업장정보 동기화 테스트 실행 시작...");
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log("--------------------------------------------------");

  try {
    // [검증 시나리오 1] 변경 사항이 없는 경우의 동기화
    console.log("[시나리오 1] 변경 사항이 없는 상태에서 동기화 기동");
    const result1 = await syncBusinessInfo(undefined, undefined, adminSupabase);
    console.log(`  -> 실행 결과: success=${result1.success}, processed=${result1.records_processed}, updated=${result1.records_updated}`);
    if (result1.records_updated === 0) {
      console.log("  -> 성공: 변경 사항이 없을 때 수정 건수 0건 처리 및 로그 삭제 확인됨.");
    } else {
      console.error("  -> 실패: 변경 사항이 없음에도 수정 건수가 발생했습니다!");
    }

    console.log("\n[시나리오 2] 특정 데이터 1건을 DB에서 임시 변경하여 동기화 유도");
    // H0437의 기존 대표자명을 조회
    const { data: originalData } = await adminSupabase
      .from("business_info")
      .select("representative_name")
      .eq("code", "H0437")
      .single();
    
    const originalName = originalData?.representative_name || "박승민 외 1명";
    console.log(`  -> 기존 H0437 대표자명: ${originalName}`);

    // DB 데이터 임시 수정 ('박승민 외 2명'으로 수정)
    const tempName = "박승민 외 2명";
    await adminSupabase
      .from("business_info")
      .update({ representative_name: tempName })
      .eq("code", "H0437");
    console.log(`  -> DB 임시 업데이트 완료: H0437 대표자명 -> '${tempName}'`);

    // 동기화 실행 (엑셀에는 '박승민 외 1명'으로 들어있을 것이므로, (변경) 로그와 함께 수정 1건이 발생해야 함)
    const result2 = await syncBusinessInfo(undefined, undefined, adminSupabase);
    console.log(`  -> 동기화 재실행 결과: success=${result2.success}, processed=${result2.records_processed}, updated=${result2.records_updated}`);
    console.log("  -> 변경 로그:", result2.change_log);

    // 원상 복구
    await adminSupabase
      .from("business_info")
      .update({ representative_name: originalName })
      .eq("code", "H0437");
    console.log(`  -> DB 데이터 원복 완료: H0437 대표자명 -> '${originalName}'`);

    if (result2.records_updated === 1 && result2.change_log && result2.change_log.some(l => l.includes("H0437") && l.includes("대표자명"))) {
      console.log("  -> 성공: 데이터 1건 변경 감지 및 동기화 업데이트 검증 완료.");
    } else {
      console.error("  -> 실패: 데이터 변경 감지 기능 또는 동기화 로그 처리에 문제가 있습니다.");
    }

    // [검증 시나리오 3] verifyDataConsistency 기동 시 "별지" 포함 사업장 제외 여부 검증
    console.log("\n[시나리오 3] 정합성 검증(verifyDataConsistency) 실행 및 '별지' 제외 검증");
    
    // verification.ts에서 verifyDataConsistency 가져오기
    const { verifyDataConsistency } = require("../lib/sync/verification");
    const verifyResult = await verifyDataConsistency(adminSupabase);
    console.log(`  -> 검증 실행 결과: success=${verifyResult.success}, issueCount=${verifyResult.issueCount}`);

    // DB에서 H0355(국립농업과학원(별지)) 건이 검증 이슈 목록에 들어가 있는지 조회
    const { data: issueH0355 } = await adminSupabase
      .from("data_verification_issues")
      .select("*")
      .eq("code", "H0355");

    console.log("  -> H0355 검증 이슈 조회 결과:", issueH0355);

    if (issueH0355 && issueH0355.length === 0) {
      console.log("  -> 성공: '별지'가 포함된 H0355 사업장이 검증 이슈 목록에서 정상 제외되었습니다.");
    } else {
      console.error("  -> 실패: '별지'가 포함된 사업장이 여전히 검증 이슈 목록에 남아있습니다!");
    }

  } catch (error) {
    console.error("동기화 실행 중 치명적인 오류 발생:", error);
  }
}

testSync();
