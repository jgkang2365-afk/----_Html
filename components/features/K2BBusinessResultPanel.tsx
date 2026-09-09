"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { useUser } from "@/hooks/use-user";
import { toast } from "sonner";

type VerificationRow = {
  journalId: number;
  code: string | null;
  businessName: string | null;
  industrialAccidentNumber: string | null;
  commencementNumber: string | null;
  verdict: string;
  actualStatus: string | null;
  actualSubmissionDate: string | null;
  internalStatus: string | null;
  internalSubmissionDate: string | null;
  submissionNumber: string | null;
  errorViewAvailable: boolean;
  errorDetail: string | null;
  approvalRequired: boolean;
};

type K2BExecution = {
  runId: string;
  queueStatus: string | null;
  workerFinishedAt: string | null;
  lastError: string | null;
  verificationRows: VerificationRow[];
};

const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);
const verdictClass = (verdict: string) => verdict === "정상"
  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
  : verdict === "오류"
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : "border-amber-200 bg-amber-50 text-amber-800";

const executionStatusLabel = (status: string | null) => {
  if (status === "success") return "검증 완료";
  if (status === "failed") return "검증 실패";
  if (status === "cancelled") return "검증 취소";
  return "검증 진행 중";
};

/** K2B worker가 저장한 관측 결과와 승인 대상만 업무 화면에 표시한다. */
export function K2BBusinessResultPanel({ refreshKey, onApproved, onExecutionFinished }: {
  refreshKey: string | null;
  onApproved: () => void;
  onExecutionFinished: (status: "success" | "failed" | "cancelled") => void;
  onVerificationQueued: (jobId: string) => void;
}) {
  const [execution, setExecution] = useState<K2BExecution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);
  const [adminFromDate, setAdminFromDate] = useState("");
  const [adminToDate, setAdminToDate] = useState("");
  const [adminQueueing, setAdminQueueing] = useState(false);
  const completionNotifiedRef = useRef<string | null>(null);
  const completionCallbackRef = useRef(onExecutionFinished);
  const { user } = useUser();
  const isAdmin = user?.role === "관리자";

  useEffect(() => { completionCallbackRef.current = onExecutionFinished; }, [onExecutionFinished]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ t: String(Date.now()) });
      if (refreshKey) params.set("id", refreshKey);
      const response = await fetch(`/api/report-processing/k2b-execution-status?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "K2B 실제결과를 불러오지 못했습니다.");
      const nextExecution = body.execution ?? null;
      setExecution(nextExecution);
      if (refreshKey && nextExecution?.runId === refreshKey && TERMINAL_STATUSES.has(nextExecution.queueStatus)) {
        const completionKey = `${nextExecution.runId}:${nextExecution.queueStatus}`;
        if (completionNotifiedRef.current !== completionKey) {
          completionNotifiedRef.current = completionKey;
          completionCallbackRef.current(nextExecution.queueStatus);
        }
      }
      setSelectedIds([]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "K2B 실제결과를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const updateVisibility = () => setIsDocumentVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  useEffect(() => {
    if (!isDocumentVisible || !execution?.queueStatus || TERMINAL_STATUSES.has(execution.queueStatus)) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [execution?.queueStatus, isDocumentVisible, refresh]);

  const approvalRows = useMemo(() => execution?.verificationRows.filter((row) => row.approvalRequired && !row.errorViewAvailable && row.actualStatus && row.actualSubmissionDate) ?? [], [execution]);
  const selectedRows = useMemo(() => approvalRows.filter((row) => selectedIds.includes(row.journalId)), [approvalRows, selectedIds]);
  const groupedRows = useMemo(() => Object.entries(selectedRows.reduce<Record<string, VerificationRow[]>>((groups, row) => {
    (groups[row.verdict] ??= []).push(row);
    return groups;
  }, {})), [selectedRows]);

  const toggle = (journalId: number) => setSelectedIds((ids) => ids.includes(journalId) ? ids.filter((id) => id !== journalId) : [...ids, journalId]);
  const toggleAll = () => setSelectedIds(selectedIds.length === approvalRows.length ? [] : approvalRows.map((row) => row.journalId));
  const approve = async () => {
    if (!execution || selectedRows.length === 0) return;
    setApproving(true);
    try {
      const response = await fetch("/api/report-processing/approve-k2b-verification", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: execution.runId, journalIds: selectedRows.map((row) => row.journalId) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "K2B 실제결과 반영에 실패했습니다.");
      toast.success(`${body.applied?.length ?? selectedRows.length}건의 K2B 실제결과를 반영했습니다.`);
      setApprovalOpen(false);
      setSelectedIds([]);
      onApproved();
      void refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "K2B 실제결과 반영에 실패했습니다.");
    } finally {
      setApproving(false);
    }
  };

  const requestAdminRangeVerification = async () => {
    if (!adminFromDate || !adminToDate) {
      toast.error("시작일과 종료일을 함께 입력해주세요.");
      return;
    }
    setAdminQueueing(true);
    try {
      const response = await fetch("/api/report-processing/verify-k2b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: adminFromDate, toDate: adminToDate }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.jobId !== "string") throw new Error(body.error || "관리자 기간 재검증 등록에 실패했습니다.");
      toast.success(body.message || "관리자 기간 K2B 실제결과 재검증을 등록했습니다.");
      onVerificationQueued(body.jobId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "관리자 기간 재검증 등록에 실패했습니다.");
    } finally {
      setAdminQueueing(false);
    }
  };

  return <>
    <Card className="space-y-3 p-4" aria-label="K2B 실제결과">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">K2B 실제결과</h2>
          <p className="text-xs text-slate-500">대표계정 로컬 작업기의 저장 결과입니다. 날짜 차이는 검토 후 선택 반영합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          {execution?.queueStatus && <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">{executionStatusLabel(execution.queueStatus)}</span>}
          <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "확인 중" : "새로고침"}</Button>
          <Button type="button" size="sm" variant="primary" disabled={selectedRows.length === 0 || execution?.queueStatus !== "success"} onClick={() => setApprovalOpen(true)}>선택 반영 ({selectedRows.length})</Button>
        </div>
      </div>
      {isAdmin && <div className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50 p-3">
        <Input type="date" label="관리자 시작일" value={adminFromDate} onChange={(event) => setAdminFromDate(event.target.value)} className="h-9 text-sm" />
        <Input type="date" label="관리자 종료일" value={adminToDate} onChange={(event) => setAdminToDate(event.target.value)} className="h-9 text-sm" />
        <Button type="button" size="sm" variant="secondary" onClick={() => void requestAdminRangeVerification()} disabled={adminQueueing}>최대 31일 재검증</Button>
      </div>}
      {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {execution?.lastError && <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">최근 검증 오류: {execution.lastError}</p>}
      {!execution && !error && <p className="text-sm text-slate-500">아직 저장된 K2B 실제결과가 없습니다. 재검증을 실행해주세요.</p>}
      {execution && <Table className="min-w-[1380px] table-fixed text-sm" maxHeight="max-h-80">
        <TableHeader><TableRow>
          <TableHead className="w-16 text-center">처리</TableHead><TableHead className="w-28">업체코드</TableHead><TableHead className="w-44">사업장</TableHead><TableHead className="w-32">산재관리번호</TableHead><TableHead className="w-24">개시번호</TableHead><TableHead className="w-28 text-center">현재 K2B 전송일</TableHead><TableHead className="w-28 text-center">K2B 실제 접수일</TableHead><TableHead className="w-28">현재 K2B 상태</TableHead><TableHead className="w-32">K2B 실제 처리상태</TableHead><TableHead className="w-28 text-center">판정</TableHead><TableHead>오류내용</TableHead>
        </TableRow></TableHeader>
        <TableBody>{execution.verificationRows.length === 0 ? <TableRow className="h-12"><TableCell colSpan={11} className="text-center text-slate-500">이번 검증에서 연결된 사업장 결과가 없습니다.</TableCell></TableRow> : execution.verificationRows.map((row) => <TableRow key={row.journalId} className="h-11">
          <TableCell className="text-center"><Checkbox aria-label={`${row.businessName || row.code || row.journalId} 반영 선택`} checked={selectedIds.includes(row.journalId)} onChange={() => toggle(row.journalId)} disabled={!approvalRows.some((candidate) => candidate.journalId === row.journalId) || execution.queueStatus !== "success"} /></TableCell>
          <TableCell className="font-mono">{row.code || "-"}</TableCell><TableCell className="truncate font-medium" title={row.businessName || undefined}>{row.businessName || "-"}</TableCell><TableCell className="font-mono">{row.industrialAccidentNumber || "-"}</TableCell><TableCell className="font-mono">{row.commencementNumber || "-"}</TableCell><TableCell className="text-center">{row.internalSubmissionDate || "-"}</TableCell><TableCell className="text-center">{row.actualSubmissionDate || "-"}</TableCell><TableCell>{row.internalStatus || "-"}</TableCell><TableCell>{row.actualStatus || "-"}{row.errorViewAvailable ? " · 오류보기" : ""}</TableCell><TableCell className="text-center"><span className={`rounded border px-2 py-1 text-xs font-semibold ${verdictClass(row.verdict)}`}>{row.verdict}</span></TableCell><TableCell className="truncate" title={row.errorDetail || undefined}>{row.errorDetail || "-"}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
    </Card>
    <Modal isOpen={approvalOpen} onClose={() => !approving && setApprovalOpen(false)} title="K2B 실제결과 반영 확인" size="lg">
      <div className="space-y-4 pt-4">
        <p className="text-sm text-slate-700">저장된 검증 작업의 실제 접수일과 처리상태만 반영합니다. 오류보기 또는 오류 판정 건은 반영할 수 없습니다.</p>
        {groupedRows.map(([verdict, rows]) => <section key={verdict} className="rounded border border-slate-200 p-3"><h3 className="text-sm font-bold text-slate-800">{verdict} · {rows.length}건</h3><ul className="mt-2 space-y-1 text-sm text-slate-600">{rows.map((row) => <li key={row.journalId}>{row.businessName || row.code || `일지 ${row.journalId}`} — {row.internalSubmissionDate || "내부 전송일 없음"} → {row.actualSubmissionDate}</li>)}</ul></section>)}
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="secondary" onClick={() => setApprovalOpen(false)} disabled={approving}>취소</Button><Button type="button" variant="primary" onClick={() => void approve()} disabled={approving}>{approving ? "반영 중" : `${selectedRows.length}건 반영`}</Button></div>
      </div>
    </Modal>
  </>;
}
