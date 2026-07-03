import { createServerClient } from "../lib/db/supabase";
import { spawn } from "child_process";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function run() {
  const supabase = createServerClient();
  const code = "H0394";
  
  // 1. 데이터 가져오기
  const { data: target, error: fetchErr } = await supabase
    .from("measurement_target_business")
    .select("*")
    .eq("code", code)
    .single();

  if (fetchErr || !target) {
    console.error("KKL 데이터 fetch 실패:", fetchErr);
    return;
  }

  // 락 적용
  await supabase
    .from("measurement_target_business")
    .update({ sync_status: "신청중", sync_error_message: null })
    .eq("id", target.id);

  console.log("파이썬 크롤러 직접 기동 시작...");
  const pythonScript = path.join(process.cwd(), "scratch/apply_national_support_cli.py");
  
  const crawler = spawn("python", [
    pythonScript,
    "--sanjae", target.industrial_accident_number,
    "--commencement", target.commencement_number,
    "--representative", target.representative_name,
    "--contact_name", "담당자",
    "--contact_phone", "01000000000",
    "--period", "하반기"
  ]);

  let stdoutData = "";
  let stderrData = "";

  crawler.stdout.on("data", (data) => { 
    stdoutData += data.toString();
    console.log("[Python Stdout]", data.toString().trim());
  });
  crawler.stderr.on("data", (data) => { 
    stderrData += data.toString();
    console.error("[Python Stderr]", data.toString().trim());
  });

  crawler.on("close", async (exitCode) => {
    console.log("크롤러 프로세스 종료. 코드:", exitCode);
    if (exitCode === 0) {
      const lines = stdoutData.split("\n").map(l => l.trim()).filter(Boolean);
      let resultJson: any = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].startsWith("{") && lines[i].endsWith("}")) {
          try {
            resultJson = JSON.parse(lines[i]);
            break;
          } catch(e) {}
        }
      }

      if (resultJson && resultJson.status === "SUCCESS") {
        const resultType = resultJson.result;
        console.log("크롤러 연동 성공 타입:", resultType);
        if (resultType === "SUPPORT") {
          // 1. 계획 테이블 상태 성공 업데이트
          await supabase
            .from("measurement_target_business")
            .update({
              sync_status: "성공",
              sync_error_message: null,
              national_support_status: "대상",
            })
            .eq("id", target.id);

          // 2. 신청결과 테이블
          await supabase
            .from("national_support_application")
            .upsert({
              code,
              year: 2026,
              period: "하반기",
              application_status: "신청완료",
              result: "대상",
              national_support_status: "대상"
            }, { onConflict: "code,year,period" });

          // 3. 마스터 테이블
          await supabase
            .from("measurement_business")
            .update({ national_support_status: "대상" })
            .eq("code", code);
            
          console.log("=== DB 업데이트 완료! (성공 반영) ===");
        } else {
          console.log("SUPPORT 가 아닌 타입이 리턴됨:", resultType);
        }
      } else {
        console.error("SUCCESS 상태가 아님:", resultJson);
      }
    } else {
      console.error("크롤러 에러 발생:", stderrData);
      await supabase
        .from("measurement_target_business")
        .update({
          sync_status: "실패",
          sync_error_message: stderrData || "크롤러 비정상 종료"
        })
        .eq("id", target.id);
    }
  });
}

run().catch(console.error);
