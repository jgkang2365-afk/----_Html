import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ path: ".env.local" });

async function check() {
  const supabase = createServerClient();
  let logText = "";

  // 1. 계획 테이블 조회 (H0440 및 H0447 동시 조회)
  const { data: plans, error: planError } = await supabase
    .from("measurement_target_business")
    .select("*")
    .in("code", ["H0440", "H0447"])
    .eq("year", 2026)
    .eq("period", "상반기");

  if (planError) {
    logText += `계획 조회 에러: ${JSON.stringify(planError, null, 2)}\n`;
  } else {
    logText += "=== measurement_target_business 조회 결과 ===\n";
    logText += JSON.stringify(plans, null, 2) + "\n";
  }

  if (plans && plans.length > 0) {
    for (const plan of plans) {
      const code = plan.code;

      logText += `\n=========================================\n`;
      logText += `[진단 대상 업체: ${plan.business_name} (${code})]\n`;
      logText += `=========================================\n`;

      // 2. 건강디딤돌 신청결과(national_support_application) 조회
      const { data: apps, error: appError } = await supabase
        .from("national_support_application")
        .select("*")
        .eq("code", code)
        .eq("year", 2026)
        .eq("period", "상반기");

      if (appError) {
        logText += `신청결과 조회 에러: ${JSON.stringify(appError, null, 2)}\n`;
      } else {
        logText += `- national_support_application 조회 결과:\n`;
        logText += JSON.stringify(apps, null, 2) + "\n";
      }

      // 3. 마스터 테이블(measurement_business) 조회
      const { data: masters, error: masterError } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code);

      if (masterError) {
        logText += `마스터 조회 에러: ${JSON.stringify(masterError, null, 2)}\n`;
      } else {
        logText += `- measurement_business (마스터) 조회 결과:\n`;
        logText += JSON.stringify(masters, null, 2) + "\n";
      }
    }
  } else {
    logText += "해당 업체의 계획 레코드를 찾을 수 없습니다.\n";
  }

  fs.writeFileSync("scratch/lexus_result_utf8.txt", logText, "utf-8");
  console.log("결과가 scratch/lexus_result_utf8.txt 에 UTF-8로 저장되었습니다.");
}

check().catch(console.error);
