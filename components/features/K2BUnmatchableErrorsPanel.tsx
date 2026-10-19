"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/hooks/use-user";
import { toast } from "sonner";

type ErrorRow = {
  id: string;
  actual_submission_date: string;
  file_name: string;
  k2b_status: string;
  error_detail: string | null;
  raw_row: Record<string, string>;
  first_seen_at: string;
  last_seen_at: string;
  submitter_user_id: number | null;
  submitter_name: string | null;
  review_state: "WAITING" | "REVIEW_REQUIRED" | "PASSED";
  approved_by_name: string | null;
  approved_at: string | null;
  approval_reason: string | null;
  approval_history: { actor_user_id: number; reason: string; approved_at: string }[];
};

const label = (state: ErrorRow["review_state"]) => state === "PASSED"
  ? "패스 완료" : state === "REVIEW_REQUIRED" ? "재검토 필요" : "확인 대기";

export function K2BUnmatchableErrorsPanel({ refreshKey }: { refreshKey: string | null }) {
  const { user } = useUser();
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const approvedIds = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/report-processing/k2b-unmatchable-errors?t=${Date.now()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "K2B 오류 원본을 불러오지 못했습니다.");
      setRows((body.errors ?? []).filter((row: ErrorRow) => row.review_state !== "PASSED" && !approvedIds.current.has(row.id)));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "K2B 오류 원본을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const approve = async (id: string) => {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/report-processing/k2b-unmatchable-errors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ errorId: id, reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "패스 처리에 실패했습니다.");
      approvedIds.current.add(id);
      setRows((current) => current.filter((row) => row.id !== id));
      toast.success(body.approval?.disposition === "already_passed" ? "이미 패스된 오류 원본입니다." : "오류 원본을 패스했습니다.");
      setSelectedId(null);
      setReason("");
      await refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "패스 처리에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return <Card className="space-y-3 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">K2B 파일오류 원본</h2>
        <p className="text-xs text-slate-600">사업장 식별정보가 없는 행을 정상 접수자료와 분리해 확인합니다.</p>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
        {loading ? "조회 중" : "오류 새로고침"}
      </Button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!error && rows.length === 0 && <p className="text-sm text-slate-500">확인할 오류 원본이 없습니다.</p>}
    <div className="space-y-2">
      {rows.map((row) => {
        const canApprove = row.review_state !== "PASSED" && (user?.role === "관리자" || Number(user?.id) === row.submitter_user_id);
        const expanded = selectedId === row.id;
        return <div key={row.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="mr-2 font-semibold text-slate-800">{row.actual_submission_date} · {row.file_name}</span>
              <span className={row.review_state === "PASSED" ? "rounded bg-emerald-100 px-2 py-0.5 text-emerald-800" : "rounded bg-amber-100 px-2 py-0.5 text-amber-800"}>{label(row.review_state)}</span>
            </div>
            {canApprove && <Button type="button" size="sm" variant="secondary" onClick={() => { setSelectedId(expanded ? null : row.id); setReason(""); }}>
              {expanded ? "닫기" : "패스 처리"}
            </Button>}
          </div>
          <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
            <p>업체: {row.raw_row["사업장명"] || row.raw_row["업체명"] || "미확정"}</p>
            <p>상태: {row.k2b_status}</p>
            <p>오류: {row.error_detail || "원본 행 확인 필요"}</p>
            <p>실제 접수자: {row.submitter_name || "미확정"}</p>
            <p>최초 발견: {row.first_seen_at}</p>
            <p>최근 확인: {row.last_seen_at}</p>
          </div>
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium">K2B 원본 행·승인 이력</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 whitespace-pre-wrap break-all">{JSON.stringify(row.raw_row, null, 2)}</pre>
            {row.approval_history.length > 0 && <ul className="mt-2 list-inside list-disc">
              {row.approval_history.map((event) => <li key={`${event.actor_user_id}-${event.approved_at}`}>{event.approved_at} · 승인자 ID {event.actor_user_id} · {event.reason}</li>)}
            </ul>}
          </details>
          {expanded && <div className="mt-3 space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">이 오류 원본은 이후 자동 동기화에서 제외됩니다. 기존 정상 접수자료는 변경되지 않습니다.</p>
            <label htmlFor={`k2b-error-reason-${row.id}`} className="block text-xs font-medium">패스 사유</label>
            <textarea id={`k2b-error-reason-${row.id}`} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000}
              className="w-full rounded border border-slate-300 bg-white p-2 text-sm" required />
            <Button type="button" size="sm" variant="primary" disabled={!reason.trim() || submitting} onClick={() => void approve(row.id)}>
              {submitting ? "처리 중" : "패스 승인"}
            </Button>
          </div>}
        </div>;
      })}
    </div>
  </Card>;
}
