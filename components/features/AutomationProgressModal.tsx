"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAutomationJob, subscribeAutomationJob } from "@/lib/automation/job-client";
import type { AutomationJob } from "@/lib/automation/jobs";

type Props = {
  jobId: string;
  title: string;
  stages: string[];
  onClose: () => void;
};

const terminal = new Set(["COMPLETED", "FAILED", "CANCELLED", "CONFIRM_REQUIRED"]);

export default function AutomationProgressModal({ jobId, title, stages, onClose }: Props) {
  const [job, setJob] = useState<AutomationJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJob(await fetchAutomationJob(jobId));
      setError(null);
    } catch (cause: any) {
      setError(cause?.message || "작업 상태를 가져오지 못했습니다.");
    }
  }, [jobId]);

  useEffect(() => {
    void refresh();
    return subscribeAutomationJob(jobId, () => void refresh());
  }, [jobId, refresh]);

  const status = job?.status || "PENDING";
  const stage = job?.progress_stage || (status === "PENDING" ? "깡통컴 연결 대기 중" : "작업 준비 중");
  const done = terminal.has(status);
  const completed = status === "COMPLETED";
  const confirm = status === "CONFIRM_REQUIRED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <p className="mt-1 text-xs text-slate-600">{stage}</p>
          </div>
          <span className={completed ? "rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700" : confirm ? "rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800" : status === "FAILED" ? "rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700" : "rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700"}>{status}</span>
        </div>
        <ol className="space-y-2" aria-label="작업 진행 단계">
          {stages.map((item, index) => {
            const active = !done && (job?.progress_percent ?? 0) >= (index / Math.max(stages.length, 1)) * 100;
            return <li key={item} className="flex items-center gap-2 text-sm text-slate-700"><span className={active || completed ? "h-2 w-2 rounded-full bg-blue-600" : "h-2 w-2 rounded-full bg-slate-200"} />{item}</li>;
          })}
        </ol>
        <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100"><div className={completed ? "h-full bg-emerald-500" : confirm ? "h-full bg-amber-500" : status === "FAILED" ? "h-full bg-red-500" : "h-full bg-blue-600"} style={{ width: `${Math.max(job?.progress_percent || 0, done ? 100 : 4)}%` }} /></div>
        {(error || job?.error_message) && <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{error || job?.error_message}</p>}
        {confirm && <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">외부 효과가 시작됐을 수 있어 자동 재실행하지 않았습니다. 결과를 확인해 주세요.</p>}
        {done && <button type="button" onClick={onClose} className="mt-5 w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900">닫기</button>}
      </div>
    </div>
  );
}
