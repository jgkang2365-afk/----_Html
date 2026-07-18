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
  mode?: "lookup_only" | "apply_if_missing" | "final_lookup";
};

type CrawlerResult = {
  status?: string;
  result?:
    | "SUPPORT"
    | "NON_SUPPORT"
    | "STANDBY"
    | "NO_RESULT"
    | "APPLIED"
    | "OVER_50"
    | "NO_EMPLOYEE_INFO"
    | "FAIL";
};

const CRAWLER_TIMEOUT_MS = 120_000;
const APPLICATION_TIMEOUT_MS = 180_000;

function runPythonAutomation(
  scriptName: string,
  args: string[],
  label: string,
  timeoutMs: number,
): Promise<CrawlerResult> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "scratch", scriptName);
    let settled = false;
    const child = spawn("python", [script, ...args], {
      windowsHide: true,
    });

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      callback();
    };

    const timeoutHandle = setTimeout(() => {
      finish(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // 프로세스가 이미 종료된 경우 무시합니다.
        }
        reject(new Error(`${label}이 제한 시간 안에 끝나지 않아 중단했습니다.`));
      });
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", error => {
      finish(() => reject(error));
    });
    child.on("close", exitCode => {
      finish(() => {
        if (exitCode !== 0) {
          reject(new Error(stderr.trim() || `${label} 프로그램 종료 코드: ${exitCode}`));
          return;
        }

        const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
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
        reject(new Error(`${label} 결과를 해석할 수 없습니다.`));
      });
    });
  });
}

function commonArgs(payload: NationalSupportJobPayload) {
  return [
    "--sanjae", payload.sanjae,
    "--commencement", payload.commencement,
    "--representative", payload.representative,
    "--contact_name", payload.contact_name || "",
    "--contact_phone", payload.contact_phone || "",
    "--period", payload.period,
  ];
}

function runCrawler(payload: NationalSupportJobPayload) {
  return runPythonAutomation(
    "apply_national_support_cli.py",
    [...commonArgs(payload), "--year", String(payload.year)],
    "건강디딤돌 조회",
    CRAWLER_TIMEOUT_MS,
  );
}

function runApplication(payload: NationalSupportJobPayload) {
  if (!payload.contact_name?.trim() || !payload.contact_phone?.trim()) {
    throw new Error("자동 신청에 필요한 담당자명 또는 휴대전화가 없습니다.");
  }
  return runPythonAutomation(
    "apply_national_support_application_cli.py",
    commonArgs(payload),
    "건강디딤돌 신청",
    APPLICATION_TIMEOUT_MS,
  );
}

export async function processNationalSupportJob(payload: NationalSupportJobPayload) {
  const supabase = await createClient();
  const mode = payload.mode || "lookup_only";
  const commonTargetFields = {
    industrial_accident_number: payload.sanjae || null,
    commencement_number: payload.commencement || null,
    representative_name: payload.representative || null,
  };

  const assertSuccessfulResult = (result: CrawlerResult, label: string) => {
    if (result.status !== "SUCCESS" || !result.result) {
      throw new Error(`${label} 결과가 누락되었습니다.`);
    }
    if (result.result === "FAIL") {
      throw new Error(`${label}이 실패했습니다.`);
    }
    return result.result;
  };

  const persistFinalStatus = async (
    supportStatus: "대상" | "비대상",
    reason: string | null,
    applicationStatus: string,
    resultLabel: string,
  ) => {
    const { error: targetError } = await supabase
      .from("measurement_target_business")
      .update({
        ...commonTargetFields,
        sync_status: "성공",
        sync_error_message: reason,
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
        application_status: applicationStatus,
        result: resultLabel,
        national_support_status: supportStatus,
      }, { onConflict: "code,year,period" });
    if (resultError) throw resultError;

    const { error: journalError } = await supabase
      .from("measurement_journal")
      .update({ national_support_status: supportStatus })
      .eq("code", payload.code)
      .eq("measurement_year", Number(payload.year))
      .eq("measurement_period", payload.period);
    if (journalError) throw journalError;

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
      payload.commencement || null,
      { updateBusinessInfo: false },
    );

    return { status: supportStatus };
  };

  try {
    let lookupResult: CrawlerResult["result"];

    if (mode === "apply_if_missing") {
      const applicationResult = assertSuccessfulResult(
        await runApplication(payload),
        "건강디딤돌 신청",
      );

      if (applicationResult === "OVER_50" || applicationResult === "NO_EMPLOYEE_INFO") {
        const reason = applicationResult === "OVER_50"
          ? "신청 시점 50인 이상 - 자동 신청 종료"
          : "공단 근로자 수 정보 없음 - 자동 신청 종료";
        const { error: waitingError } = await supabase
          .from("measurement_target_business")
          .update({
            ...commonTargetFields,
            sync_status: "비대상대기",
            sync_error_message: reason,
            national_support_status: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payload.target_id);
        if (waitingError) throw waitingError;
        return { status: "비대상(대기)" };
      }

      if (applicationResult !== "APPLIED") {
        throw new Error("건강디딤돌 신청 완료 여부를 확인할 수 없습니다.");
      }

      lookupResult = assertSuccessfulResult(
        await runCrawler(payload),
        "건강디딤돌 신청 후 조회",
      );
    } else {
      lookupResult = assertSuccessfulResult(
        await runCrawler(payload),
        "건강디딤돌 조회",
      );
    }

    if (lookupResult === "SUPPORT" || lookupResult === "NON_SUPPORT") {
      const isSupported = lookupResult === "SUPPORT";
      return persistFinalStatus(
        isSupported ? "대상" : "비대상",
        isSupported ? null : "공단 비대상 판정 확인",
        isSupported ? "○" : "신청취소",
        isSupported ? "대상" : "비대상",
      );
    }

    if (mode === "final_lookup") {
      return persistFinalStatus(
        "비대상",
        "측정일지 등록 후 최종 조회에서 신청결과 없음",
        "미신청",
        "신청결과 없음",
      );
    }

    const statusMessage = mode === "apply_if_missing"
      ? "건강디딤돌 신청 완료 - 공단 결과 반영 대기"
      : lookupResult === "NO_RESULT"
        ? "공단 내역 없음"
        : "공단 심사 대기 중";
    const { error: pendingError } = await supabase
      .from("measurement_target_business")
      .update({
        ...commonTargetFields,
        sync_status: mode === "apply_if_missing" ? "신청완료대기" : "확인대기",
        sync_error_message: statusMessage,
        national_support_status: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.target_id);
    if (pendingError) throw pendingError;

    return { status: mode === "apply_if_missing" ? "신청완료(결과 대기)" : "확인대기" };
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
