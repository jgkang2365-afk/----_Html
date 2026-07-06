import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { EmailService } from "@/lib/email/email-service";
import { normalizeRepresentativeName } from "@/lib/utils/data-utils";
import { syncToMasterTables } from "../../route";

/**
 * 건강디딤돌 자동 신청 API
 * POST /api/businesses/national-support/apply
 */
export async function POST(request: NextRequest) {
  try {
    // 권한 검증
    await checkPermission("journal:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      target_id,
      sanjae,
      commencement,
      representative,
      contact_name,
      contact_phone,
      period,
      code,
      year,
    } = body;

    // 필수 입력값 검증 (담당자명 및 연락처는 결과 조회 시 필수 항목이 아니므로 제외)
    if (!target_id || !sanjae || !commencement || !representative || !period || !code || !year) {
      return NextResponse.json(
        { error: "필수 요청 항목이 누락되었습니다." },
        { status: 400 }
      );
    }

    if (period.includes("(수시)")) {
      return NextResponse.json(
        { error: "수시 주기는 건강디딤돌 지원 대상이 아닙니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 중복 전송 방지를 위한 락(Lock) 확인 및 설정
    const { data: currentPlan, error: selectError } = await supabase
      .from("measurement_target_business")
      .select("sync_status, national_support_status")
      .eq("id", target_id)
      .single();

    if (selectError) {
      console.error("대상 사업장 조회 실패:", selectError);
      return NextResponse.json(
        { error: "대상 사업장 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (currentPlan.national_support_status !== "대상") {
      return NextResponse.json(
        { error: "국고 지원 대상 사업장이 아닙니다." },
        { status: 400 }
      );
    }

    if (currentPlan.sync_status === "신청중") {
      return NextResponse.json(
        { error: "이미 해당 사업장에 대한 자동 신청 작업이 기동되어 진행 중입니다." },
        { status: 400 }
      );
    }

    // 기존 건강디딤돌 신청결과 테이블을 조회하여 결과 존재 시 즉시 동기화 처리
    const { data: existingApp, error: appError } = await supabase
      .from("national_support_application")
      .select("national_support_status")
      .eq("code", code)
      .eq("year", parseInt(String(year)))
      .eq("period", period)
      .maybeSingle();

    if (!appError && existingApp && (existingApp.national_support_status === "대상" || existingApp.national_support_status === "비대상")) {
      const dbStatus = existingApp.national_support_status;

      // 계획 테이블(measurement_target_business) 즉시 성공 처리 및 상태 업데이트
      const { error: errTarget } = await supabase
        .from("measurement_target_business")
        .update({
          sync_status: "성공",
          sync_error_message: null,
          national_support_status: dbStatus,
          industrial_accident_number: sanjae || null,
          commencement_number: commencement || null,
          representative_name: representative || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target_id);

      if (errTarget) {
        console.error("즉시 동기화 계획 테이블 업데이트 실패:", errTarget);
      }

      // 마스터 테이블(measurement_business, business_info) 최종 확정 동기화
      try {
        const { data: targetBusiness } = await supabase
          .from("measurement_target_business")
          .select("business_name")
          .eq("id", target_id)
          .single();
        
        const bName = targetBusiness?.business_name || "미등록 사업장";

        await syncToMasterTables(
          supabase,
          code,
          Number(year),
          period,
          bName,
          representative || null,
          sanjae || null,
          commencement || null
        );
      } catch (mbErr) {
        console.error(`즉시 동기화 마스터 테이블 업데이트 중 예외 발생 (code: ${code}):`, mbErr);
      }

      return NextResponse.json({
        success: true,
        message: `기존 건강디딤돌 신청결과(${dbStatus})가 즉시 반영되었습니다.`,
        instantSync: true,
        status: dbStatus,
      });
    }


    // 락 적용: sync_status를 '신청중'으로 변경하고 에러 메시지 초기화 및 가입력 값 저장
    const { error: lockError } = await supabase
      .from("measurement_target_business")
      .update({
        sync_status: "신청중",
        sync_error_message: null,
        industrial_accident_number: sanjae || null,
        commencement_number: commencement || null,
        representative_name: representative || null,
      })
      .eq("id", target_id);

    if (lockError) {
      console.error("락 설정 실패:", lockError);
      return NextResponse.json(
        { error: "자동 신청 상태를 변경하는 데 실패했습니다." },
        { status: 500 }
      );
    }

    // 백그라운드 크롤링 프로세스 기동 (API 응답 대기 지연을 방지하기 위해 비동기로 호출)
    // 건강디딤돌 조회를 위해 대표자명 실시간 1인 정규화 적용
    runApplyCrawler({
      target_id,
      sanjae,
      commencement,
      representative: normalizeRepresentativeName(representative) || representative,
      contact_name: contact_name || "",
      contact_phone: contact_phone || "",
      period,
      code,
      year,
    });

    return NextResponse.json({
      success: true,
      message: "자동 신청 요청이 백그라운드에서 시작되었습니다. 결과는 잠시 후 반영됩니다.",
    });

  } catch (error: any) {
    console.error("자동 신청 API 기동 오류:", error);
    return NextResponse.json(
      { error: error.message || "자동 신청 기동 중 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 백그라운드에서 Headless Python 크롤러를 비동기로 구동하고 DB 동기화 및 메일 발송을 처리합니다.
 */
async function runApplyCrawler(params: {
  target_id: string;
  sanjae: string;
  commencement: string;
  representative: string;
  contact_name: string;
  contact_phone: string;
  period: string;
  code: string;
  year: string | number;
}) {
  const {
    target_id,
    sanjae,
    commencement,
    representative,
    contact_name,
    contact_phone,
    period,
    code,
    year,
  } = params;

  const supabase = await createClient();
  const pythonScript = path.join(process.cwd(), "scratch/apply_national_support_cli.py");

  console.log(`[Crawler Launch] 백그라운드 크롤러 구동 시작 - 대상 ID: ${target_id}`);

  // 파이썬 자식 프로세스 기동 (조회에 필요한 연도 인자 추가)
  const crawler = spawn("python", [
    pythonScript,
    "--sanjae",
    sanjae,
    "--commencement",
    commencement,
    "--representative",
    representative,
    "--contact_name",
    contact_name,
    "--contact_phone",
    contact_phone,
    "--period",
    period,
    "--year",
    String(year)
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
    console.log(`[Crawler Close] 프로세스 종료 코드: ${exitCode}`);
    try {
      if (exitCode === 0) {
        // 정상 종료인 경우 stdout에 출력된 최종 JSON 결과를 파싱
        const lines = stdoutData.split("\n").map((l) => l.trim()).filter(Boolean);
        let resultJson: any = null;

        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            if (lines[i].startsWith("{") && lines[i].endsWith("}")) {
              resultJson = JSON.parse(lines[i]);
              break;
            }
          } catch (jsonErr) {
            // JSON 파싱 에러 시 윗 라인으로 탐색 지속
          }
        }

        if (resultJson && resultJson.status === "SUCCESS") {
          const resultType = resultJson.result; // "SUPPORT", "NON_SUPPORT", "STANDBY", "NO_RESULT", "FAIL"

          if (resultType === "SUPPORT") {
            // [대상 확정 케이스]
            // 1. 계획 테이블 상태 성공 업데이트
            const { error: err1 } = await supabase
              .from("measurement_target_business")
              .update({
                sync_status: "성공",
                sync_error_message: null,
                national_support_status: "대상",
                industrial_accident_number: sanjae || null,
                commencement_number: commencement || null,
                representative_name: representative || null,
              })
              .eq("id", target_id);
            if (err1) throw err1;

            // 2. 신청결과 테이블 Upsert
            const { error: err2 } = await supabase
              .from("national_support_application")
              .upsert(
                {
                  code,
                  year: parseInt(String(year)),
                  period,
                  application_status: "○",
                  result: "대상",
                  national_support_status: "대상",
                },
                { onConflict: "code,year,period" }
              );
            if (err2) throw err2;

            // 3. 마스터 테이블 최종 확정 동기화
            try {
              const { data: targetBusiness } = await supabase
                .from("measurement_target_business")
                .select("business_name")
                .eq("id", target_id)
                .single();
              
              const bName = targetBusiness?.business_name || "미등록 사업장";

              await syncToMasterTables(
                supabase,
                code,
                Number(year),
                period,
                bName,
                representative || null,
                sanjae || null,
                commencement || null
              );
            } catch (mbErr) {
              console.error(`[Sync Master Exception] 마스터 테이블 업데이트 중 예외 발생 (code: ${code}):`, mbErr);
            }

            console.log(`[Crawler Success Sync Complete] 사업장 코드 ${code} 대상 확정 연동 완료`);
          } else if (resultType === "NON_SUPPORT") {
            // [비대상 확정 케이스]
            // 1. 계획 테이블 상태 성공 업데이트 및 비대상 기록
            const { error: err1 } = await supabase
              .from("measurement_target_business")
              .update({
                sync_status: "성공",
                sync_error_message: "공단 비대상 판정 확인",
                national_support_status: "비대상",
                industrial_accident_number: sanjae || null,
                commencement_number: commencement || null,
                representative_name: representative || null,
              })
              .eq("id", target_id);
            if (err1) throw err1;

            // 2. 신청결과 테이블 Upsert (비대상)
            const { error: err2 } = await supabase
              .from("national_support_application")
              .upsert(
                {
                  code,
                  year: parseInt(String(year)),
                  period,
                  application_status: "신청취소",
                  result: "비대상",
                  national_support_status: "비대상",
                },
                { onConflict: "code,year,period" }
              );
            if (err2) throw err2;

            // 3. 마스터 테이블 최종 확정 동기화
            try {
              const { data: targetBusiness } = await supabase
                .from("measurement_target_business")
                .select("business_name")
                .eq("id", target_id)
                .single();
              
              const bName = targetBusiness?.business_name || "미등록 사업장";

              await syncToMasterTables(
                supabase,
                code,
                Number(year),
                period,
                bName,
                representative || null,
                sanjae || null,
                commencement || null
              );
            } catch (mbErr) {
              console.error(`[Sync Master Exception] 마스터 테이블 업데이트 중 예외 발생 (code: ${code}):`, mbErr);
            }

            console.log(`[Crawler Success Sync Complete] 사업장 코드 ${code} 비대상 판정 연동 완료`);
          } else {
            // [대기 / 결과미발표 케이스 ("STANDBY", "NO_RESULT" 등)]
            const statusMsg = resultType === "NO_RESULT" ? "공단 내역 없음" : "공단 심사 대기 중";
            
            // 1. 계획 테이블에 확인대기 상태로 기재
            const { error: err1 } = await supabase
              .from("measurement_target_business")
              .update({
                sync_status: "확인대기",
                sync_error_message: statusMsg,
                national_support_status: "대상", // 조회가 안된 것일 뿐이므로 대상 입력 상태 유지
              })
              .eq("id", target_id);
            if (err1) throw err1;

            console.log(`[Crawler Standby Logged] 사업장 코드 ${code} - ${statusMsg}`);
          }
        } else {
          throw new Error("크롤러의 실행 결과가 JSON 규격에 맞지 않거나 누락되었습니다.");
        }
      } else {
        // 비정상 종료 (에러)
        throw new Error(stderrData || "파이썬 자동화 스크립트가 에러와 함께 종료되었습니다.");
      }
    } catch (err: any) {
      console.error(`[Crawler Background Fatal Error] 대상 ID: ${target_id}:`, err);

      // DB에 실패 상태 및 에러 메시지 기록
      await supabase
        .from("measurement_target_business")
        .update({
          sync_status: "실패",
          sync_error_message: err.message || "자동 연동 시스템 에러",
        })
        .eq("id", target_id);

      // 사용자/관리자 긴급 경고 인앱 알림 발송
      try {
        const { data: managers } = await supabase
          .from("users")
          .select("id")
          .eq("is_journal_manager", true);

        if (managers && managers.length > 0) {
          const notifications = managers.map((m) => ({
            user_id: m.id,
            type: "error",
            message: `[건강디딤돌 에러] 자동 신청 중 오류 발생 (산재번호: ${sanjae}, 사유: ${err.message || "시스템 에러"})`,
            is_read: false,
          }));

          await supabase.from("notifications").insert(notifications);
          console.log("[Crawler Error Alert] 관리자 인앱 알림 전송 완료");
        }
      } catch (notiErr) {
        console.error("[Crawler Noti Fail] 관리자 알림 전송 중 실패:", notiErr);
      }
    }
  });
}
