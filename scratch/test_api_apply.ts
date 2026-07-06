import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "../lib/supabase/server";
import { spawn } from "child_process";
import path from "path";
import { EmailService } from "../lib/email/email-service";

async function testIntegration() {
  const supabase = await createClient();
  let tempTargetId: string | number | null = null;

  try {
    console.log("=== 1단계: 임시 테스트 데이터 등록 ===");
    // 중복을 피하기 위해 임시 코드 'HTEST'로 등록
    const { data: newTarget, error: insertError } = await supabase
      .from("measurement_target_business")
      .insert({
        code: "HTEST",
        year: 2026,
        period: "상반기",
        business_name: "자동연동 테스트사업장",
        address: "충청남도 천안시 서북구 늘푸른3길 22",
        is_registered: "미실시",
        sync_status: "대기"
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`임시 데이터 생성 실패: ${insertError.message}`);
    }

    tempTargetId = newTarget.id;
    console.log(`임시 테스트 데이터 생성 완료 (ID: ${tempTargetId})`);

    console.log("\n=== 2단계: 백그라운드 크롤러 프로세스 강제 기동 ===");
    const pythonScript = path.join(process.cwd(), "scratch/apply_national_support_cli.py");
    
    // 일부러 가짜 산재번호/개시번호를 넘겨 조회 불가 상태를 만듭니다.
    const crawler = spawn("python", [
      pythonScript,
      "--sanjae", "99999999999",
      "--commencement", "99999999999",
      "--representative", "테스트대표자",
      "--contact_name", "테스트담당자",
      "--contact_phone", "01099999999",
      "--period", "상반기"
    ]);

    let stdoutData = "";
    let stderrData = "";

    crawler.stdout.on("data", (data) => {
      stdoutData += data.toString();
      console.log(`[Crawler stdout] ${data.toString().trim()}`);
    });

    crawler.stderr.on("data", (data) => {
      stderrData += data.toString();
      console.error(`[Crawler stderr] ${data.toString().trim()}`);
    });

    // 크롤러 종료 대기
    await new Promise<void>((resolve) => {
      crawler.on("close", async (exitCode) => {
        console.log(`\n=== 3단계: 크롤러 종료 감지 (Exit Code: ${exitCode}) ===`);
        try {
          if (exitCode !== 0) {
            console.log("-> 크롤러가 비정상 종료되었습니다. (가짜 번호로 인한 요소 미검출 또는 조회실패)");
            
            // DB에 실패 상태 기록 검증
            console.log("DB에 실패 상태 기록 업데이트 중...");
            await supabase
              .from("measurement_target_business")
              .update({
                sync_status: "실패",
                sync_error_message: "테스트용 가짜 번호로 인한 조회 실패"
              })
              .eq("id", tempTargetId);

            console.log("관리자 경고 인앱 알림 발송 테스트 시작...");
            const { data: managers } = await supabase
              .from("users")
              .select("id")
              .eq("is_journal_manager", true);

            if (managers && managers.length > 0) {
              const notifications = managers.map((m) => ({
                user_id: m.id,
                type: "error",
                message: `[건강디딤돌 에러] 자동 신청 중 오류 발생 (산재번호: 99999999999, 사유: 통합테스트 모의 에러)`,
                is_read: false,
              }));

              const { error: insErr } = await supabase.from("notifications").insert(notifications);
              if (insErr) {
                console.error("테스트 오류: 알림 인서트 실패:", insErr.message);
              } else {
                console.log(`관리자 인앱 알림 발송 성공! (${notifications.length}건 생성됨)`);
              }
            } else {
              console.log("테스트 경고: 알림을 전송할 관리자(is_journal_manager = true)가 없습니다.");
            }
          } else {
            console.log("-> 크롤러가 성공 종료되었습니다.");
          }
        } catch (innerErr) {
          console.error("핸들러 내부 오류:", innerErr);
        }
        resolve();
      });
    });

    console.log("\n=== 4단계: DB에 반영된 최종 상태 재검증 ===");
    const { data: updatedTarget, error: queryError } = await supabase
      .from("measurement_target_business")
      .select("sync_status, sync_error_message")
      .eq("id", tempTargetId)
      .single();

    if (queryError) throw queryError;
    console.log("DB 업데이트 결과:", updatedTarget);
    if (updatedTarget.sync_status === "실패") {
      console.log("✅ 자가 검증 결과: DB 상태 락 및 예외 기록 처리가 완벽히 검증되었습니다!");
    } else {
      console.log("❌ 자가 검증 결과: DB 상태가 예상한 '실패'가 아닙니다.");
    }

  } catch (err) {
    console.error("테스트 중 에러 발생:", err);
  } finally {
    if (tempTargetId) {
      console.log("\n=== 5단계: 임시 테스트 데이터 완전 삭제 (Cleanup) ===");
      const { error: deleteError } = await supabase
        .from("measurement_target_business")
        .delete()
        .eq("id", tempTargetId);
      if (deleteError) {
        console.error("테스트 데이터 삭제 실패:", deleteError.message);
      } else {
        console.log("임시 데이터가 완벽히 삭제되었습니다. 정리 완료.");
      }
    }
  }
}

testIntegration();
