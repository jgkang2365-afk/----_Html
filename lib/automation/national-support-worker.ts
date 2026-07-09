import { spawn } from "child_process";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { syncToMasterTables } from "@/lib/sync/master-tables";

export type NationalSupportJobPayload = {
  target_id: number | string;
  sanjae: string;
  commencement: string;
  representative: string;
  contact_name?: string;
  contact_phone?: string;
  period: string;
  code: string;
  year: string | number;
};

type CrawlerResult = {
  status?: string;
  result?: "SUPPORT" | "NON_SUPPORT" | "STANDBY" | "NO_RESULT" | "FAIL";
};

const CRAWLER_TIMEOUT_MS = 120_000;

function runCrawler(payload: NationalSupportJobPayload): Promise<CrawlerResult> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "scratch/apply_national_support_cli.py");
    let settled = false;
    const child = spawn("python", [
      script,
      "--sanjae", payload.sanjae,
      "--commencement", payload.commencement,
      "--representative", payload.representative,
      "--contact_name", payload.contact_name || "",
      "--contact_phone", payload.contact_phone || "",
      "--period", payload.period,
      "--year", String(payload.year),
    ], {
      windowsHide: true,
    });

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const timeout = setTimeout(() => {
      finish(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // 프로세스가 이미 종료된 경우 무시합니다.
        }
        reject(new Error("건강디딤돌 조회가 120초 안에 끝나지 않아 중단했습니다."));
      });
    }, CRAWLER_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.on("error", error => {
      finish(() => reject(error));
    });
    child.on("close", exitCode => {
      finish(() => {
        if (exitCode !== 0) {
          reject(new Error(stderr.trim() || `건강디딤돌 조회 프로그램 종료 코드: ${exitCode}`));
          return;
        }

        const lines = stdout.split("\n").map(line => line.trim()).filter(Boolean);
        for (let index = lines.length - 1; index >= 0; index--) {
          try {
            const parsed = JSON.parse(lines[index]);
            if (parsed && typeof parsed === "object") {
              resolve(parsed);
              return;
            }
          } catch {
            // 마지막 JSON 결과가 나올 때까지 이전 줄을 확인합니다.
          }
        }
        reject(new Error("건강디딤돌 조회 결과를 해석할 수 없습니다."));
      });
    });
  });
}

export async function processNationalSupportJob(payload: NationalSupportJobPayload) {
  const supabase = await createClient();

  try {
    const crawlerResult = await runCrawler(payload);
    if (crawlerResult.status !== "SUCCESS" || !crawlerResult.result) {
      throw new Error("건강디딤돌 조회 결과가 누락되었습니다.");
    }
    if (crawlerResult.result === "FAIL") {
      throw new Error("공단 건강디딤돌 조회가 실패했습니다.");
    }

    const commonTargetFields = {
      industrial_accident_number: payload.sanjae || null,
      commencement_number: payload.commencement || null,
      representative_name: payload.representative || null,
    };

    if (crawlerResult.result === "SUPPORT" || crawlerResult.result === "NON_SUPPORT") {
      const isSupported = crawlerResult.result === "SUPPORT";
      const supportStatus = isSupported ? "대상" : "비대상";

      const { error: targetError } = await supabase
        .from("measurement_target_business")
        .update({
          ...commonTargetFields,
          sync_status: "성공",
          sync_error_message: isSupported ? null : "공단 비대상 판정 확인",
          national_support_status: supportStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.target_id);
      if (targetError) throw targetError;

      const { error: resultError } = await supabase
        .from("national_support_application")
        .upsert({
          code: payload.code,
          year: Number(payload.year),
          period: payload.period,
          application_status: isSupported ? "○" : "신청취소",
          result: supportStatus,
          national_support_status: supportStatus,
        }, { onConflict: "code,year,period" });
      if (resultError) throw resultError;

      const { data: target } = await supabase
        .from("measurement_target_business")
        .select("business_name")
        .eq("id", payload.target_id)
        .single();

      await syncToMasterTables(
        supabase,
        payload.code,
        Number(payload.year),
        payload.period,
        target?.business_name || "미등록 사업장",
        payload.representative || null,
        payload.sanjae || null,
        payload.commencement || null
      );

      return { status: supportStatus };
    }

    const statusMessage = crawlerResult.result === "NO_RESULT"
      ? "공단 내역 없음"
      : "공단 심사 대기 중";
    const { error: pendingError } = await supabase
      .from("measurement_target_business")
      .update({
        ...commonTargetFields,
        sync_status: "확인대기",
        sync_error_message: statusMessage,
        national_support_status: "대상",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.target_id);
    if (pendingError) throw pendingError;

    return { status: "확인대기" };
  } catch (error: any) {
    await supabase
      .from("measurement_target_business")
      .update({
        sync_status: "실패",
        sync_error_message: error?.message || "자동 연동 시스템 오류",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.target_id);

    throw error;
  }
}
