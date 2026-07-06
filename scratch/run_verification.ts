import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";
import { verifyDataConsistency } from "../lib/sync/verification";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("=== [Test] 데이터 정합성 검사 실행 ===");
  const result = await verifyDataConsistency(supabase);
  console.log("검사 실행 결과:", result);

  console.log("\n=== [Test] DB 내 H0394 관련 불일치 이슈 조회 ===");
  const { data: issues, error } = await supabase
    .from("data_verification_issues")
    .select("*")
    .eq("code", "H0394");

  if (error) {
    console.error("이슈 조회 실패:", error);
  } else {
    console.log("H0394 관련 감지된 이슈 목록 (총 " + issues.length + "건):");
    console.log(JSON.stringify(issues, null, 2));
  }
}

main().catch(console.error);
