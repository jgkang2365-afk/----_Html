"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type K2BExecution = {
  runId: string;
  requestedAt: string | null;
  trigger: "manual" | "scheduled" | "unknown";
  queueStatus: string;
  workerStartedAt: string | null;
  workerFinishedAt: string | null;
  queueWaitMs: number | null;
  serializationDisposition: string;
  remoteK2BReadAttempted: boolean;
  remoteK2BReadExecuted: boolean;
  resultDate: string | null;
  candidateCounts: { dated?: number; manual?: number; total?: number } | null;
  remoteRowCount: number | null;
  matchCounts: { green?: number; yellow?: number; red?: number; ambiguous?: number; unmatched?: number } | null;
  databaseSaveCompleted: boolean;
  persistence: { attempted?: number; saved?: number; failed?: number } | null;
  remoteReadState: string;
  queriedDates: string[];
  failureStage: string | null;
  uploadExecuted: boolean;
  lastError: string | null;
};

const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);

function displayTime(value: string | null) {
  return value ? value.substring(0, 16).replace("T", " ") : "-";
}

export function K2BExecutionStatusPanel({ refreshKey }: { refreshKey: string | null }) {
  const [execution, setExecution] = useState<K2BExecution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams({ t: String(Date.now()) });
      if (refreshKey) search.set("id", refreshKey);
      const response = await fetch(`/api/report-processing/k2b-execution-status?${search}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "K2B 실행상태를 불러오지 못했습니다.");
      setExecution(body.execution ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "K2B 실행상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  useEffect(() => {
    if (!execution || TERMINAL_STATUSES.has(execution.queueStatus)) return;
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [execution, refresh]);

  return <Card className="space-y-3 p-4" aria-label="최근 K2B 실제결과 검증 실행상태">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-base font-bold text-slate-800">최근 K2B 검증 실행</h2><p className="text-xs text-slate-500">원격 조회·매칭·DB 저장에서 실제 기록된 상태만 표시합니다.</p></div>
      <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "확인 중" : "상태 새로고침"}</Button>
    </div>
    {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
    {!execution && !error && <p className="text-sm text-slate-500">기록된 K2B 검증 실행이 없습니다.</p>}
    {execution && <>
      <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-slate-500">Run ID / 요청</dt><dd className="truncate font-mono" title={execution.runId}>{execution.runId}</dd><dd>{displayTime(execution.requestedAt)}</dd></div>
        <div><dt className="text-slate-500">방식 / Queue</dt><dd className="font-semibold">{execution.trigger} · {execution.queueStatus}</dd><dd>직렬화 {execution.serializationDisposition === "accepted_without_active_k2b" ? "활성 작업 없이 등록" : "근거 미기록"}</dd></div>
        <div><dt className="text-slate-500">Worker 시작 / 종료</dt><dd>{displayTime(execution.workerStartedAt)}</dd><dd>{displayTime(execution.workerFinishedAt)}</dd></div>
        <div><dt className="text-slate-500">대상 / 원격 행</dt><dd>{execution.candidateCounts?.total ?? "미집계"}건 / {execution.remoteRowCount ?? "미집계"}건</dd><dd>큐 대기 {execution.queueWaitMs == null ? "미집계" : `${Math.round(execution.queueWaitMs / 1000)}초`}</dd></div>
      </dl>
      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <p className={`rounded border px-3 py-2 ${execution.remoteK2BReadExecuted ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>실제 K2B remote read: <strong>{execution.remoteK2BReadExecuted ? "완료" : execution.remoteK2BReadAttempted ? "시도됨·미완료" : "미확인"}</strong><span className="block">상태 {execution.remoteReadState} · 조회일 {execution.queriedDates.join(", ") || "없음"}</span></p>
        <p className="rounded border border-slate-200 px-3 py-2">신호 집계: 🟢 {execution.matchCounts?.green ?? 0} · 🟡 {execution.matchCounts?.yellow ?? 0} · 🔴 {execution.matchCounts?.red ?? 0}<span className="block">모호 {execution.matchCounts?.ambiguous ?? 0} · 미매칭 {execution.matchCounts?.unmatched ?? 0}</span></p>
        <p className="rounded border border-slate-200 px-3 py-2">DB 저장: <strong>{execution.databaseSaveCompleted ? "완료" : "미완료"}</strong><span className="block">{execution.persistence?.saved ?? 0}/{execution.persistence?.attempted ?? 0}건 · 실패 {execution.persistence?.failed ?? 0}</span></p>
        <p className="rounded border border-slate-200 px-3 py-2">업로드 실행: <strong>{execution.uploadExecuted ? "예" : "아니오"}</strong><span className="block">검증일 {execution.resultDate || "-"}</span></p>
      </div>
      {execution.lastError && <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><strong>마지막 오류:</strong> {execution.lastError}</p>}
      {execution.failureStage && <p className="text-xs text-slate-600"><strong>실패 단계:</strong> {execution.failureStage}</p>}
    </>}
  </Card>;
}
