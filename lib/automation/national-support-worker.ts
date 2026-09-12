import { spawn, spawnSync } from "child_process";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import {
  FINAL_LOOKUP_DELAY_MS,
  FINAL_LOOKUP_MAX_ATTEMPTS,
  type ApplicationResult,
  type PortalLookupResult,
  shouldRetryFinalLookup,
} from "@/lib/national-support/workflow";
import {
  isValidNationalSupportContactName,
  isValidNationalSupportMobile,
} from "@/lib/national-support/eligibility";
import { hasMeasurementJournalForTarget, type NationalSupportResultCode } from "@/lib/national-support/automation-contract";

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
  result?: PortalLookupResult | ApplicationResult | "JOURNAL_REGISTERED_SKIP" | "GUARD_ERROR";
};

export type NationalSupportProcessResult = {
  resultCode: NationalSupportResultCode;
  followUp?: {
    payload: NationalSupportJobPayload;
    availableAt: Date;
  };
};

const CRAWLER_TIMEOUT_MS = 120_000;
const INTEGRATED_FLOW_TIMEOUT_MS = 300_000;

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

type WorkerBoundaryReply = { allow: boolean; reason?: string };

function runPythonAutomation(
  scriptName: string,
  args: string[],
  label: string,
  timeoutMs: number,
  onWorkerEvent?: (event: string) => Promise<WorkerBoundaryReply>,
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
    let stdoutBuffer = "";
    child.stdout.on("data", data => {
      const chunk = data.toString();
      stdout += chunk;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line.trim());
          if (event?.event && onWorkerEvent && child.stdin.writable) {
            void onWorkerEvent(String(event.event))
              .then(reply => child.stdin.write(`${JSON.stringify(reply)}\n`))
              .catch(() => child.stdin.write('{"allow":false}\n'));
          }
        } catch {
          // Non-protocol output is retained for the final structured result.
        }
      }
    });
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

function runIntegratedFlow(
  payload: NationalSupportJobPayload,
  onWorkerEvent?: (event: string) => Promise<WorkerBoundaryReply>,
) {
  if (
    !isValidNationalSupportContactName(payload.contact_name) ||
    !isValidNationalSupportMobile(payload.contact_phone)
  ) {
    throw new Error("자동 신청에 사용할 수 있는 담당자명 또는 010 휴대전화가 없습니다.");
  }
  return runPythonAutomation(
    "national_support_flow_cli.py",
    [...commonArgs(payload), "--year", String(payload.year)],
    "건강디딤돌 업체 단위 조회·신청",
    INTEGRATED_FLOW_TIMEOUT_MS,
    onWorkerEvent,
  );
}

export async function processNationalSupportJob(
  payload: NationalSupportJobPayload,
  options: { onWorkerEvent?: (event: string) => Promise<WorkerBoundaryReply> } = {},
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

  const updateProgress = async (_syncStatus: string, message: string) => {
    const { error } = await supabase
      .from("measurement_target_business")
      .update({
        ...commonTargetFields,
        sync_error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.target_id);
    if (error) throw error;
  };

  const handleLookupResult = async (
    lookupResult: PortalLookupResult,
  ): Promise<NationalSupportProcessResult | null> => {
    if (lookupResult === "SUPPORT" || lookupResult === "NON_SUPPORT") {
      return { resultCode: lookupResult };
    }
    if (lookupResult === "FAIL") throw new Error("건강디딤돌 조회가 실패했습니다.");
    return null;
  };

  try {
    if (mode === "apply_if_missing") {
      // Guard 2: this runs immediately before the integrated flow can reach
      // its application action, closing the enqueue-to-effect race.
      if (await hasMeasurementJournalForTarget(supabase, payload)) {
        await updateProgress("성공", "측정일지 등록이 확인되어 신청하지 않았습니다.");
        return { resultCode: "JOURNAL_REGISTERED_SKIP" };
      }
      const flowResult = resultCode(
        await runIntegratedFlow(payload, options.onWorkerEvent),
        "건강디딤돌 업체 단위 조회·신청",
      );
      console.info("[NationalSupportWorker] 통합 조회·신청 판정 완료", {
        target_id: payload.target_id,
        mode,
        result: flowResult,
      });

      if (
        flowResult === "SUPPORT" ||
        flowResult === "NON_SUPPORT" ||
        flowResult === "STANDBY" ||
        flowResult === "NO_RESULT"
      ) {
        const lookupResult = flowResult as PortalLookupResult;
        const final = await handleLookupResult(lookupResult);
        if (final) return final;
        if (lookupResult === "STANDBY") {
          await updateProgress(
            "확인대기",
            "기존 신청 또는 심사 중인 내역이 확인되어 신청하지 않았습니다.",
          );
          return { resultCode: "ALREADY_APPLIED" };
        }
        throw new Error("통합 자동화가 조회 결과 없음 이후 신청 단계를 완료하지 못했습니다.");
      }

      if (flowResult === "JOURNAL_REGISTERED_SKIP") {
        await updateProgress("성공", "측정일지 등록이 확인되어 신청하지 않았습니다.");
        return { resultCode: "JOURNAL_REGISTERED_SKIP" };
      }
      if (flowResult === "GUARD_ERROR") {
        throw new Error("건강디딤돌 Guard2 조회 오류로 신청을 중단했습니다.");
      }
      const applicationResult = flowResult as ApplicationResult;

      if (applicationResult === "OVER_50" || applicationResult === "NO_EMPLOYEE_INFO" || applicationResult === "EMPLOYEE_CHECK_FAILED") {
        await updateProgress(
          "비대상대기",
          applicationResult === "OVER_50"
            ? "신청 시점 50인 이상 - 사용자가 직접 확인해야 합니다."
            : applicationResult === "NO_EMPLOYEE_INFO"
              ? "공단 근로자 수 정보 없음 - 사용자가 직접 확인해야 합니다."
              : "공단 근로자 수 확인에 실패해 다음날 재확인합니다.",
        );
        return { resultCode: applicationResult === "OVER_50" ? "OVER_50_RECHECK" : applicationResult === "NO_EMPLOYEE_INFO" ? "NO_EMPLOYEE_INFO_RECHECK" : "EMPLOYEE_CHECK_FAILED_RECHECK" };
      }

      if (applicationResult === "ALREADY_APPLIED") {
        await updateProgress("확인대기", "기존 신청 내역이 확인되어 결과 조회를 대기합니다.");
        return { resultCode: "ALREADY_APPLIED" };
      } else if (applicationResult !== "APPLIED") {
        await updateProgress("수동확인필요", "자동 신청 완료 여부를 명확히 확인하지 못했습니다.");
        return { resultCode: "APPLICATION_UNCERTAIN" };
      } else {
        await updateProgress("신청완료대기", "신청 완료가 확인되어 공단 결과 반영을 기다립니다.");
      }
      return {
        resultCode: "APPLIED_WAITING_RESULT",
        followUp: {
          payload: { ...payload, mode: "final_lookup", attempt_count: 0 },
          availableAt: new Date(Date.now() + FINAL_LOOKUP_DELAY_MS),
        },
      };
    }

    const lookupResult = resultCode(
      await runCrawler(payload),
      "건강디딤돌 조회",
    ) as PortalLookupResult;
    const final = await handleLookupResult(lookupResult);
    console.info("[NationalSupportWorker] 조회 판정 완료", {
      target_id: payload.target_id,
      mode,
      lookupResult,
    });
    if (final) return final;


    if (mode === "final_lookup") {
      if (shouldRetryFinalLookup(lookupResult, attemptCount)) {
        await updateProgress("신청완료대기", "공단 결과 반영 대기 중이며 후속 조회가 예약되었습니다.");
        return {
          resultCode: "APPLIED_WAITING_RESULT",
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
      return { resultCode: "APPLICATION_UNCERTAIN" };
    }

    await updateProgress(
      lookupResult === "NO_RESULT" ? "조회대기" : "확인대기",
      lookupResult === "NO_RESULT" ? "공단에 조회된 내역이 없습니다." : "공단 심사 또는 결과 반영 대기 중입니다.",
    );
    return { resultCode: lookupResult === "NO_RESULT" ? "LOOKUP_NO_RESULT" : "ALREADY_APPLIED" };
  } catch (error: any) {
    await supabase
      .from("measurement_target_business")
      .update({
        sync_error_message: error?.message || "자동 연동 시스템 오류",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.target_id);
    throw error;
  }
}
