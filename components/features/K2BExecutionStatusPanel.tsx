"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type K2BExecution = {
  runId: string;
  requestedAt: string | null;
  trigger: string | null;
  queueStatus: string | null;
  workerStartedAt: string | null;
  workerFinishedAt: string | null;
  queueWaitMs: number | null;
  serializationDisposition: string | null;
  remoteK2BReadAttempted: boolean | null;
  remoteK2BReadExecuted: boolean | null;
  fromDate: string | null;
  toDate: string | null;
  requestedRange: Record<string, unknown> | null;
  queriedRange: Record<string, unknown> | null;
  host: string | null;
  sourceHost: string | null;
  cursorBefore: string | null;
  cursorAfter: string | null;
  cursorAdvanced: boolean | null;
  cursorEligible: boolean | null;
  remoteRowCount: number | null;
  candidateCounts: Record<string, unknown> | null;
  matchCounts: Record<string, unknown> | null;
  persistence: Record<string, unknown> | null;
  rawReceiptPersistence: PersistedCounts | null;
  journalVerification: PersistedCounts | null;
  databaseSaveCompleted: boolean | null;
  remoteReadState: string | null;
  queriedDates: string[] | null;
  dateResults: unknown[] | null;
  failureStage: string | null;
  uploadExecuted: boolean | null;
  lastError: string | null;
};

type PersistedCounts = {
  attempted: number | null;
  saved: number | null;
  failed: number | null;
  insertedCount: number | null;
  updatedCount: number | null;
  unchangedCount: number | null;
  fallbackKeyCount: number | null;
  matched: number | null;
};

const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);

function displayTime(value: string | null) {
  return value ? value.substring(0, 16).replace("T", " ") : "-";
}

function stored(value: string | number | boolean | null | undefined) {
  return value == null ? "미기록" : String(value);
}

function remoteReadLabel(execution: K2BExecution) {
  if (execution.remoteK2BReadExecuted === true) return "완료";
  if (execution.remoteK2BReadAttempted === true) return "시도됨·미완료";
  if (execution.remoteK2BReadAttempted === false) return "미시도";
  return "미기록";
}

function dateResultLabel(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "형식 미기록";
  const value = result as Record<string, unknown>;
  return [stored(typeof value.date === "string" ? value.date : null), stored(typeof value.outcome === "string" ? value.outcome : null), `행 ${stored(typeof value.rowCount === "number" ? value.rowCount : null)}`].join(" · ");
}

function storedCount(counts: Record<string, unknown> | null, key: string) {
  const value = counts?.[key];
  return stored(typeof value === "number" ? value : null);
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
    if (!execution || !execution.queueStatus || TERMINAL_STATUSES.has(execution.queueStatus)) return;
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [execution, refresh]);

  return <Card className="space-y-3 p-4" aria-label="최근 K2B 실제결과 검증 실행상태">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-base font-bold text-slate-800">최근 K2B 원본 동기화</h2><p className="text-xs text-slate-500">원격 조회·원본 receipt·일지 연계에서 실제 기록된 상태만 표시합니다.</p></div>
      <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "확인 중" : "상태 새로고침"}</Button>
    </div>
    {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
    {!execution && !error && <p className="text-sm text-slate-500">기록된 K2B 검증 실행이 없습니다.</p>}
    {execution && <>
      <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-slate-500">Run ID / 요청</dt><dd className="truncate font-mono" title={execution.runId}>{execution.runId}</dd><dd>{displayTime(execution.requestedAt)}</dd></div>
        <div><dt className="text-slate-500">방식 / Queue</dt><dd className="font-semibold">{stored(execution.trigger)} · {stored(execution.queueStatus)}</dd><dd>직렬화 {stored(execution.serializationDisposition)}</dd></div>
        <div><dt className="text-slate-500">Worker 시작 / 종료</dt><dd>{displayTime(execution.workerStartedAt)}</dd><dd>{displayTime(execution.workerFinishedAt)}</dd><dd className="truncate" title={execution.sourceHost || undefined}>source host {stored(execution.sourceHost)}</dd></div>
        <div><dt className="text-slate-500">조회 범위 / 원격 행</dt><dd>from {stored(execution.fromDate)} ~ to {stored(execution.toDate)}</dd><dd>{stored(execution.remoteRowCount)}건 · 큐 대기 {execution.queueWaitMs == null ? "미기록" : `${Math.round(execution.queueWaitMs / 1000)}초`}</dd></div>
      </dl>
      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <p className={`rounded border px-3 py-2 ${execution.remoteK2BReadExecuted === true ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>실제 K2B remote read: <strong>{remoteReadLabel(execution)}</strong><span className="block">시도 {stored(execution.remoteK2BReadAttempted)} · 실행 {stored(execution.remoteK2BReadExecuted)}</span><span className="block">상태 {stored(execution.remoteReadState)} · 조회일 {execution.queriedDates?.join(", ") || "미기록"}</span></p>
        <p className="rounded border border-slate-200 px-3 py-2">원본 receipt DB 저장: <strong>{stored(execution.databaseSaveCompleted)}</strong><span className="block">저장 {stored(execution.rawReceiptPersistence?.saved)} / 시도 {stored(execution.rawReceiptPersistence?.attempted)} · 실패 {stored(execution.rawReceiptPersistence?.failed)}</span><span className="block">신규 {stored(execution.rawReceiptPersistence?.insertedCount)} · 갱신 {stored(execution.rawReceiptPersistence?.updatedCount)} · 동일 {stored(execution.rawReceiptPersistence?.unchangedCount)}</span></p>
        <p className="rounded border border-slate-200 px-3 py-2">일지 연계: <strong>매칭 {stored(execution.journalVerification?.matched)}</strong><span className="block">저장 {stored(execution.journalVerification?.saved)}</span><span className="block">fallback key {stored(execution.rawReceiptPersistence?.fallbackKeyCount)}</span></p>
        <p className="rounded border border-slate-200 px-3 py-2">업로드 실행: <strong>{stored(execution.uploadExecuted)}</strong><span className="block">cursor {stored(execution.cursorBefore)} → {stored(execution.cursorAfter)}</span><span className="block">전진 {stored(execution.cursorAdvanced)} · 대상 {stored(execution.cursorEligible)}</span></p>
      </div>
      <p className="rounded border border-slate-200 px-3 py-2 text-xs">검증 신호(기록된 verify run에만 해당): 🟢 {storedCount(execution.matchCounts, "green")} · 🟡 {storedCount(execution.matchCounts, "yellow")} · 🔴 {storedCount(execution.matchCounts, "red")}<span className="block">후보 {storedCount(execution.candidateCounts, "total")} · 검증 저장 {storedCount(execution.persistence, "saved")} / 시도 {storedCount(execution.persistence, "attempted")}</span></p>
      <div className="rounded border border-slate-200 px-3 py-2 text-xs"><strong>날짜별 조회 결과</strong><p className="mt-1 text-slate-600">{execution.dateResults?.length ? execution.dateResults.map(dateResultLabel).join(" / ") : "미기록"}</p></div>
      {execution.lastError && <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><strong>마지막 오류:</strong> {execution.lastError}</p>}
      {execution.failureStage && <p className="text-xs text-slate-600"><strong>실패 단계:</strong> {execution.failureStage}</p>}
    </>}
  </Card>;
}
