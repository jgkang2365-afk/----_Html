"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchAutomationJob, subscribeAutomationJob } from "@/lib/automation/job-client";
import type { AutomationJob } from "@/lib/automation/jobs";
import RemoteJobProgressDialog, { type RemoteJobProgressView } from "@/components/features/RemoteJobProgressDialog";

type Props = { jobId: string; title: string; processingMessage: string; visible?: boolean; onClose: () => void; onTerminal?: () => void; onCancel?: () => void | Promise<void>; cancelLabel?: string; cancelDisabled?: boolean };
const terminal = new Set(["COMPLETED", "FAILED", "CANCELLED", "CONFIRM_REQUIRED"]);
export type AutomationProgressView = RemoteJobProgressView;
export function automationProgressView(job: Pick<AutomationJob, "status" | "progress_percent" | "error_message" | "started_at"> | null, processingMessage: string): AutomationProgressView {
  const status = job?.status || "PENDING", percent = job?.progress_percent ?? 0;
  if (status === "COMPLETED") return { step: 3, heading: "작업이 완료되었습니다", detail: "결과를 확인할 수 있습니다.", tone: "green" };
  if (status === "CONFIRM_REQUIRED") return { step: percent >= 75 ? 2 : 1, heading: "결과 확인이 필요합니다", detail: "외부 작업 결과가 확실하지 않아 자동으로 다시 실행하지 않았습니다.", tone: "amber" };
  if (status === "FAILED") return { step: percent >= 75 ? 2 : job?.started_at ? 1 : 0, heading: "작업 처리에 실패했습니다", detail: job?.error_message || "작업 상태를 확인한 뒤 다시 시도해 주세요.", tone: "red" };
  if (status === "CANCELLED") return { step: job?.started_at ? (percent >= 75 ? 2 : 1) : 0, heading: "작업이 중단되었습니다", detail: "중단 요청이 완료되었습니다.", tone: "slate" };
  if (status === "CANCEL_REQUESTED") return { step: 1, heading: "중단 요청을 전달했습니다", detail: "깡통컴에서 현재 작업을 안전하게 정리하고 있습니다.", tone: "amber" };
  if (status === "RUNNING") return { step: percent >= 75 ? 2 : 1, heading: processingMessage, detail: "처리가 끝나면 자동으로 결과를 확인합니다.", tone: "blue" };
  return { step: 0, heading: "요청을 깡통컴에 전달하고 있습니다", detail: "작업이 시작되면 진행 상태를 계속 알려드립니다.", tone: "blue" };
}
export default function AutomationProgressModal(props: Props) {
  const [job, setJob] = useState<AutomationJob | null>(null); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { try { setJob(await fetchAutomationJob(props.jobId)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "작업 상태를 가져오지 못했습니다."); } }, [props.jobId]);
  useEffect(() => { void refresh(); return subscribeAutomationJob(props.jobId, () => void refresh()); }, [props.jobId, refresh]);
  useEffect(() => {
    if (job && terminal.has(job.status) && props.visible === false) props.onTerminal?.();
  }, [job, props]);
  const view = error ? { step: 0, heading: error, detail: "연결 상태를 확인한 뒤 다시 시도해 주세요.", tone: "red" as const } : automationProgressView(job, props.processingMessage);
  const running = !terminal.has(job?.status || "PENDING");
  const handleClose = () => {
    if (terminal.has(job?.status || "PENDING")) {
      if (props.onTerminal) props.onTerminal();
      else props.onClose();
    }
    else props.onClose();
  };
  return props.visible === false ? null : <RemoteJobProgressDialog title={props.title} view={view} running={running} onClose={handleClose} onCancel={props.onCancel} cancelLabel={props.cancelLabel} cancelPending={props.cancelDisabled || job?.status === "CANCEL_REQUESTED"} />;
}
