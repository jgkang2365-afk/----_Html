"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAutomationJob, subscribeAutomationJob } from "@/lib/automation/job-client";
import type { AutomationJob } from "@/lib/automation/jobs";
import RemoteJobProgressDialog, { type RemoteJobProgressDetail, type RemoteJobProgressView } from "@/components/features/RemoteJobProgressDialog";

type Props = { jobId: string; title: string; processingMessage: string; nationalSupport?: boolean; mes?: boolean; visible?: boolean; onClose: () => void; onTerminal?: () => void; observedJob?: { job: AutomationJob | null; error: string | null }; onCancel?: () => void | Promise<void>; cancelLabel?: string; cancelDisabled?: boolean };
export const AUTOMATION_TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED", "CONFIRM_REQUIRED"]);
export const AUTOMATION_PROGRESS_FALLBACK_POLL_MS = 5000;
export type AutomationProgressView = RemoteJobProgressView;
export function automationProgressView(job: (Pick<AutomationJob, "status" | "progress_percent"> & Partial<Pick<AutomationJob, "error_message" | "started_at">>) | null, processingMessage: string): AutomationProgressView {
  const status = job?.status || "PENDING", percent = job?.progress_percent ?? 0;
  if (status === "COMPLETED") return { step: 3, heading: "작업이 완료되었습니다", detail: "결과를 확인할 수 있습니다.", tone: "green" };
  if (status === "CONFIRM_REQUIRED") return { step: percent >= 75 ? 2 : 1, heading: "결과 확인이 필요합니다", detail: "외부 작업 결과가 확실하지 않아 자동으로 다시 실행하지 않았습니다.", tone: "amber" };
  if (status === "FAILED") return { step: percent >= 75 ? 2 : job?.started_at ? 1 : 0, heading: "작업 처리에 실패했습니다", detail: job?.error_message || "작업 상태를 확인한 뒤 다시 시도해 주세요.", tone: "red" };
  if (status === "CANCELLED") return { step: job?.started_at ? (percent >= 75 ? 2 : 1) : 0, heading: "작업이 중단되었습니다", detail: "중단 요청이 완료되었습니다.", tone: "slate" };
  if (status === "CANCEL_REQUESTED") return { step: 1, heading: "중단 요청을 전달했습니다", detail: "깡통컴에서 현재 작업을 안전하게 정리하고 있습니다.", tone: "amber" };
  if (status === "RUNNING") return { step: percent >= 75 ? 2 : 1, heading: processingMessage, detail: "처리가 끝나면 자동으로 결과를 확인합니다.", tone: "blue" };
  return { step: 0, heading: "요청을 깡통컴에 전달하고 있습니다", detail: "작업이 시작되면 진행 상태를 계속 알려드립니다.", tone: "blue" };
}

export function nationalSupportProgressView(job: Pick<AutomationJob, "status" | "progress_percent" | "result_code" | "effect_started_at"> | null, processingMessage: string): AutomationProgressView {
  if (job?.status === "COMPLETED") {
    switch (job.result_code) {
      case "SUPPORT": return { step: 3, heading: "건강디딤돌 지원 대상 확인", detail: "공단 결과에서 지원 대상으로 확인되었습니다.", tone: "green" };
      case "NON_SUPPORT": return { step: 3, heading: "건강디딤돌 비대상 확인", detail: "공단 결과에서 지원 비대상으로 확인되었습니다.", tone: "slate" };
      case "LOOKUP_NO_RESULT": return { step: 3, heading: "건강디딤돌 조회 결과가 없습니다", detail: "현재 조회 조건에서 확인되는 건강디딤돌 정보가 없습니다. 신청은 진행하지 않았습니다.", tone: "amber" };
      case "APPLIED_WAITING_RESULT": return { step: 3, heading: "신청 완료 · 결과 대기", detail: "신청 완료가 확인됐습니다. 공단 결과가 반영되면 사업장 상태가 갱신됩니다.", tone: "amber" };
      case "ALREADY_APPLIED": return { step: 3, heading: "신청·결과 확인 대기", detail: "기존 신청 또는 심사 중인 내역이 확인되었습니다.", tone: "amber" };
      case "OVER_50_RECHECK": return { step: 3, heading: "근로자 수 확인 필요", detail: "50인 이상 판정으로 신청을 보류했습니다. 직접 확인이 필요합니다.", tone: "amber" };
      case "NO_EMPLOYEE_INFO_RECHECK":
      case "EMPLOYEE_CHECK_FAILED_RECHECK": return { step: 3, heading: "근로자 수 재확인 대기", detail: "근로자 수를 확정하지 못해 신청을 보류했습니다.", tone: "amber" };
      case "JOURNAL_REGISTERED_SKIP": return { step: 3, heading: "자동 처리 제외 · 측정일지 등록", detail: "동일 연도·주기의 측정일지가 있어 자동 조회·신청을 실행하지 않았습니다. 직접 결과 조회는 가능합니다.", tone: "amber" };
      case "TARGET_STATUS_SKIP": return { step: 3, heading: "조회 제외 · 사업장 상태", detail: "거래종료·수시 또는 활성 상태가 아니어서 조회·신청을 실행하지 않았습니다.", tone: "amber" };
      case "REPRESENTATIVE_REVIEW_SKIP": return { step: 3, heading: "신청 대표자 확인 필요", detail: "복수 대표자명을 임의로 선택하지 않았습니다. 신청 대표자를 지정해 주세요.", tone: "amber" };
      case "APPLICATION_INFO_CHANGED_SKIP": return { step: 3, heading: "신청 정보 재확인 필요", detail: "대기 중 저장 정보가 바뀌었거나 부족해 신청을 실행하지 않았습니다.", tone: "amber" };
      default: return { step: 3, heading: "작업 결과 확인 필요", detail: "결과 코드를 확인할 수 없습니다. 사업장 상태를 다시 확인해 주세요.", tone: "amber" };
    }
  }
  if (job?.status === "FAILED") {
    if (job.effect_started_at) {
      return { step: job.progress_percent >= 75 ? 2 : 1, heading: "건강디딤돌 신청 결과 확인이 필요합니다", detail: "신청 또는 데이터 변경이 시작되었을 수 있어 결과를 자동으로 확정할 수 없습니다. 기존 기록을 확인해 주세요.", tone: "amber" };
    }
    return { step: job.progress_percent >= 75 ? 2 : 1, heading: "건강디딤돌 조회 결과를 확인하지 못했습니다", detail: "조회 과정에서 처리 오류가 발생하여 결과를 확정할 수 없습니다. 안전을 위해 신청은 진행하지 않았습니다. 잠시 후 다시 시도해 주세요. 같은 오류가 반복되면 관리자에게 확인해 주세요.", tone: "red" };
  }
  if (job?.status === "CONFIRM_REQUIRED") {
    return { step: job.progress_percent >= 75 ? 2 : 1, heading: "건강디딤돌 신청 결과 확인이 필요합니다", detail: "신청 또는 데이터 변경 여부를 자동으로 확정할 수 없습니다. 기존 기록을 확인해 주세요.", tone: "amber" };
  }
  return automationProgressView(job, processingMessage);
}

export function nationalSupportProgressDetails(job: Pick<AutomationJob, "id" | "status" | "progress_stage" | "error_code" | "finished_at" | "updated_at"> | null): RemoteJobProgressDetail[] {
  if (!job || !["FAILED", "CONFIRM_REQUIRED"].includes(job.status)) return [];
  const details: RemoteJobProgressDetail[] = [{ label: "작업 ID", value: job.id }];
  if (job.finished_at || job.updated_at) details.unshift({ label: "발생 시각", value: job.finished_at || job.updated_at });
  if (job.progress_stage) details.push({ label: "작업 단계", value: job.progress_stage });
  if (job.error_code && /^[A-Z][A-Z0-9_]{1,63}$/.test(job.error_code)) details.push({ label: "오류 코드", value: job.error_code });
  return details;
}
export const mesProgressDetails = nationalSupportProgressDetails;

export function handleVisibleAutomationEscape(
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">,
  state: { visible: boolean | undefined; running: boolean; cancelDisabled: boolean | undefined },
  onCancel: (() => void | Promise<void>) | undefined,
) {
  if (event.key !== "Escape" || !state.visible || !state.running || !onCancel || state.cancelDisabled) return false;
  event.preventDefault();
  event.stopPropagation();
  void onCancel();
  return true;
}

export function mesProgressView(job: Pick<AutomationJob, "status" | "progress_percent" | "effect_started_at"> | null, processingMessage: string): AutomationProgressView {
  if (job?.status === "CONFIRM_REQUIRED" || (job?.status === "FAILED" && job.effect_started_at)) {
    return {
      step: job?.progress_percent >= 75 ? 2 : 1,
      heading: "MES 동기화 결과 확인이 필요합니다",
      detail: "데이터 반영이 시작된 이후 작업 상태를 확정하지 못했습니다. 자동으로 다시 실행하지 않았습니다. 기존 결과를 확인해 주세요.",
      tone: "amber",
    };
  }
  if (job?.status === "FAILED") {
    return {
      step: job.progress_percent >= 75 ? 2 : 1,
      heading: "MES 자동화 실행에 실패했습니다",
      detail: "MES 화면 제어 과정에서 문제가 발생했습니다. 데이터 반영은 시작되지 않았습니다. MES 프로그램 상태를 확인한 뒤 다시 시도해 주세요.",
      tone: "red",
    };
  }
  return automationProgressView(job, processingMessage);
}

export default function AutomationProgressModal(props: Props) {
  const [loadedJob, setJob] = useState<AutomationJob | null>(null);
  const [loadError, setError] = useState<string | null>(null);
  const externallyObserved = props.observedJob !== undefined;
  const job = props.observedJob ? props.observedJob.job : loadedJob;
  const error = props.observedJob ? props.observedJob.error : loadError;
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const nextJob = await fetchAutomationJob(props.jobId);
      if (sequence !== refreshSequence.current) return;
      setJob(nextJob);
      setError(null);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      setError(cause instanceof Error ? cause.message : "작업 상태를 가져오지 못했습니다.");
    }
  }, [props.jobId]);
  useEffect(() => {
    if (externallyObserved) return;
    void refresh();
    return subscribeAutomationJob(props.jobId, () => void refresh());
  }, [externallyObserved, props.jobId, refresh]);
  useEffect(() => {
    if (job && AUTOMATION_TERMINAL_STATUSES.has(job.status) && props.visible === false) props.onTerminal?.();
  }, [job, props]);
  const view = error ? { step: 0, heading: props.nationalSupport ? "건강디딤돌 작업 상태를 가져오지 못했습니다" : props.mes ? "MES 작업 상태를 가져오지 못했습니다" : error, detail: "잠시 후 다시 시도해 주세요.", tone: "red" as const } : props.nationalSupport ? nationalSupportProgressView(job, props.processingMessage) : props.mes ? mesProgressView(job, props.processingMessage) : automationProgressView(job, props.processingMessage);
  const running = !AUTOMATION_TERMINAL_STATUSES.has(job?.status || "PENDING");
  useEffect(() => {
    if (props.visible === false || !running || externallyObserved) return;
    let cancelled = false;
    let timer: number | undefined;
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const scheduleFallback = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => {
        await refresh();
        if (!cancelled) scheduleFallback();
      }, AUTOMATION_PROGRESS_FALLBACK_POLL_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearTimer();
        return;
      }
      void refresh().finally(scheduleFallback);
    };
    scheduleFallback();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [externallyObserved, props.visible, refresh, running]);
  const cancelAction = running ? props.onCancel : undefined;
  useEffect(() => {
    if (!props.visible || !running || !cancelAction || props.cancelDisabled) return;
    const handleEscape = (event: KeyboardEvent) => {
      handleVisibleAutomationEscape(event, {
        visible: props.visible,
        running,
        cancelDisabled: props.cancelDisabled,
      }, cancelAction);
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [cancelAction, props.cancelDisabled, props.visible, running]);
  const handleClose = () => {
    if (AUTOMATION_TERMINAL_STATUSES.has(job?.status || "PENDING")) {
      if (props.onTerminal) props.onTerminal();
      else props.onClose();
    } else props.onClose();
  };
  return props.visible === false ? null : <RemoteJobProgressDialog title={props.title} view={view} running={running} onClose={handleClose} onCancel={cancelAction} cancelLabel={props.cancelLabel} cancelPending={props.cancelDisabled || job?.status === "CANCEL_REQUESTED"} details={props.nationalSupport || props.mes ? mesProgressDetails(job) : []} />;
}
