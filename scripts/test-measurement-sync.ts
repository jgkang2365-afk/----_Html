/**
 * 측정사업장 동기화 테스트 스크립트
 * 실제 동기화 로직을 사용하여 파싱 테스트
 */

import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { syncMeasurementBusiness } from "../lib/sync/excel-sync";

const filePath = path.join(process.cwd(), "측정대상사업장목록_업로드 양식_2026-01-23.xlsx");

console.log("=== 측정사업장 동기화 테스트 ===\n");
console.log(`파일 경로: ${filePath}\n`);

async function test() {
  try {
    // 동기화 실행 (DB에 저장되지만 테스트이므로 로그만 확인)
    const result = await syncMeasurementBusiness(filePath);

    console.log("\n=== 동기화 결과 ===");
    console.log(`성공 여부: ${result.success}`);
    console.log(`파일명: ${result.file_name}`);
    console.log(`처리된 레코드: ${result.records_processed}`);
    console.log(`삽입된 레코드: ${result.records_inserted}`);
    console.log(`업데이트된 레코드: ${result.records_updated}`);

    if (!result.success) {
      console.error(`오류: ${result.error_message}`);
    }
  } catch (error) {
    console.error("테스트 실행 중 오류 발생:", error);
  }
}

test();
