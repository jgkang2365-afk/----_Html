import { spawn, spawnSync } from "child_process";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { syncToMasterTables } from "@/lib/sync/master-tables";
import {
  FINAL_LOOKUP_DELAY_MS,
  FINAL_LOOKUP_MAX_ATTEMPTS,
  type ApplicationResult,
  type PortalLookupResult,
  shouldApplyAfterLookup,
  shouldRetryFinalLookup,
} from "@/lib/national-support/workflow";
import {
  isValidNationalSupportContactName,
  isValidNationalSupportMobile,
} from "@/lib/national-support/eligibility";

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
  requested_by?: number | string;
  attempt_count?: number;
};

type AutomationResult = {
  status?: string;
  result?: PortalLookupResult | ApplicationResult;
};

export type NationalSupportProcessResult = {
  status: string;
  followUp?: {
    payload: NationalSupportJobPayload;
    availableAt: Date;
  };
};

const CRAWLER_TIMEOUT_MS = 120_000;
const APPLICATION_TIMEOUT_MS = 180_000;

function terminateProcessTree(childPid?: number) {
  if (!childPid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(childPid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-childPid, "SIGKILL");
  } catch {
    // 이미 종료된 작업입니다.
  }
}

function runPythonAutomation(
  scriptName: string,
  args: string[],
  label: string,
  timeoutMs: number,
): Promise<AutomationResult> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "scratch", scriptName);
    let settled = false;
    const child = spawn("python", [script, ...args], {
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      callback();
    };
    const timeoutHandle = setTimeout(() => {
      finish(() => {
        terminateProcessTree(child.pid);
        reject(new Error(`${label}이 제한 시간 안에 끝나지 않아 중단했습니다.`));
      });
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.on("error", error => finish(() => reject(error)));
    child.on("close", exitCode => {
      finish(() => {
        if (exitCode !== 0) {
          reject(new Error(stderr.trim() || `${label} 프로그램 종료 코드: ${exitCode}`));
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
            // 마지막 JSON 결과 이전의 로그는 건너뜁니다.
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
  if (
    !isValidNationalSupportContactName(payload.contact_name) ||
    !isValidNationalSupportMobile(payload.contact_phone)
  ) {
    throw new Error("자동 신청에 사용할 수 있는 담당자명 또는 010 휴대전화가 없습니다.");
  }
  return runPythonAutomation(
    "apply_national_support_application_cli.py",
    [...commonArgs(payload), "--year", String(payload.year)],
    "건강디딤돌 신청",
    APPLICATION_TIMEOUT_MS,
  );
}

export async function processNationalSupportJob(
  payload: NationalSupportJobPayload,
): Promise<NationalSupportProcessResult> {
  const supabase = await createClient();
  const mode = payload.mode || "lookup_only";
  const attemptCount = Number(payload.attempt_count || 0);
  const commonTargetFields = {
    industrial_accident_number: payload.sanjae || null,
    commencement_number: payload.commencement || null,
    representative_name: payload.representative || null,
  };

  const resultCode = (result: AutomationResult, label: string) => {
    if (result.status !== "SUCCESS" || !result.result || result.result === "FAIL") {
      throw new Error(`${label}이 실패했거나 결과가 누락되었습니다.`);
    }
    return result.result;
  };

  const updateProgress = async (syncStatus: string, message: string) => {
    const { error } = await supabase
      .from("measurement_target_business")
      .update({
        ...commonTargetFields,
        sync_status: syncStatus,
        sync_error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.target_id);
    if (error) throw error;
  };

  const persistFinalStatus = async (
    supportStatus: "대상" | "비대상",
    reason: string | null,
    applicationStatus: string,
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
        result: supportStatus,
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

  const handleLookupResult = async (
    lookupResult: PortalLookupResult,
  ): Promise<NationalSupportProcessResult | null> => {
    if (lookupResult === "SUPPORT" || lookupResult === "NON_SUPPORT") {
      const supported = lookupResult === "SUPPORT";
      return persistFinalStatus(
        supported ? "대상" : "비대상",
        supported ? null : "공단 비대상 판정 확인",
        supported ? "○" : "신청취소",
      );
    }
    if (lookupResult === "FAIL") throw new Error("건강디딤돌 조회가 실패했습니다.");
    return null;
  };

  try {
    const lookupResult = resultCode(
      await runCrawler(payload),
      "건강디딤돌 조회",
    ) as PortalLookupResult;
    const final = await handleLookupResult(lookupResult);
    if (final) return final;

    if (mode === "apply_if_missing" && shouldApplyAfterLookup(lookupResult)) {
      const applicationResult = resultCode(
        await runApplication(payload),
        "건강디딤돌 신청",
      ) as ApplicationResult;

      if (applicationResult === "OVER_50" || applicationResult === "NO_EMPLOYEE_INFO") {
        await updateProgress(
          "비대상대기",
          applicationResult === "OVER_50"
            ? "신청 시점 50인 이상 - 사용자가 직접 확인해야 합니다."
            : "공단 근로자 수 정보 없음 - 사용자가 직접 확인해야 합니다.",
        );
        return { status: "비대상(대기)" };
      }
      if (applicationResult === "ALREADY_APPLIED") {
        await updateProgress("확인대기", "기존 신청 내역이 확인되어 결과 조회를 대기합니다.");
      } else if (applicationResult !== "APPLIED") {
        await updateProgress("수동확인필요", "자동 신청 완료 여부를 명확히 확인하지 못했습니다.");
        return { status: "수동확인필요" };
      } else {
        await updateProgress("신청완료대기", "신청 완료가 확인되어 공단 결과 반영을 기다립니다.");
      }
      return {
        status: "신청완료(결과 대기)",
        followUp: {
          payload: { ...payload, mode: "final_lookup", attempt_count: 0 },
          availableAt: new Date(Date.now() + FINAL_LOOKUP_DELAY_MS),
        },
      };
    }

    if (mode === "final_lookup") {
      if (shouldRetryFinalLookup(lookupResult, attemptCount)) {
        await updateProgress("신청완료대기", "공단 결과 반영 대기 중이며 후속 조회가 예약되었습니다.");
        return {
          status: "신청완료(결과 대기)",
          followUp: {
            payload: {
              ...payload,
              mode: "final_lookup",
              attempt_count: attemptCount + 1,
            },
            availableAt: new Date(Date.now() + FINAL_LOOKUP_DELAY_MS),
          },
        };
      }
      await updateProgress(
        "수동확인필요",
        `공단 결과를 ${FINAL_LOOKUP_MAX_ATTEMPTS}회 후속 조회했으나 확정하지 못했습니다.`,
      );
      return { status: "수동확인필요" };
    }

    await updateProgress(
      "확인대기",
      lookupResult === "NO_RESULT" ? "공단에 조회된 내역이 없습니다." : "공단 심사 또는 결과 반영 대기 중입니다.",
    );
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
