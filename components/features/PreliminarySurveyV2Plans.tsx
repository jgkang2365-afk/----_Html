"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";

type WorkbenchStatus = "unassigned" | "recommended" | "adjustment_required" | "provisional" | "review_required" | "true_confirmed";

interface WorkbenchRow {
  targetId: number;
  code: string;
  businessName: string;
  address?: string | null;
  kind: string;
  measurementDate: string | null;
  preliminaryDate: string | null;
  surveyors: string[];
  participantUserIds?: number[];
  surveyMethod: "field" | "phone";
  sourceMeasurementDate?: string;
  sourceMeasurerId?: number | null;
  sourceResponsibleUserId?: number;
  sourceRuleType?: "new" | "existing";
  mainMeasurer?: string;
  helper?: string;
  reportWriter?: string;
  status: WorkbenchStatus;
  conflict: string | null;
  reason?: string;
  alternatives?: string[];
  locked?: boolean;
}

interface SurveyUser {
  id: number;
  name: string;
  is_active: boolean;
  is_preliminary_survey_experienced: boolean;
}

const STATUS_LABELS: Record<WorkbenchStatus, string> = {
  unassigned: "미추천",
  recommended: "추천",
  adjustment_required: "조정 필요",
  provisional: "가확정",
  review_required: "재검토 필요",
  true_confirmed: "찐확정",
};

const STATUS_STYLES: Record<WorkbenchStatus, string> = {
  unassigned: "bg-slate-100 text-slate-700",
  recommended: "bg-blue-100 text-blue-700",
  adjustment_required: "bg-amber-100 text-amber-800",
  provisional: "bg-emerald-100 text-emerald-800",
  review_required: "bg-orange-100 text-orange-800",
  true_confirmed: "bg-purple-100 text-purple-800",
};

export function PreliminarySurveyV2Plans({ mode = "plan" }: { mode?: "plan" | "list" }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [period, setPeriod] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [preliminaryDateFilter, setPreliminaryDateFilter] = useState("");
  const [measurementDateFilter, setMeasurementDateFilter] = useState("");
  const [surveyorFilter, setSurveyorFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const [drafts, setDrafts] = useState<Map<number, WorkbenchRow>>(new Map());
  const [users, setUsers] = useState<SurveyUser[]>([]);
  const [selected, setSelected] = useState<WorkbenchRow | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editMethod, setEditMethod] = useState<"field" | "phone">("field");
  const [editParticipants, setEditParticipants] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (period) params.set("period", period);
      const response = await fetch(`/api/preliminary-survey-v2/workbench?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "예비조사 통합 현황 조회 실패");
      setRows(result.rows || []);
      setUsers(result.users || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예비조사 통합 현황 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [period, year]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const displayRows = useMemo(() => rows.map((row) => drafts.get(row.targetId) ?? row).filter((row) =>
    (!statusFilter || row.status === statusFilter) &&
    (!kindFilter || row.kind === kindFilter) &&
    (!preliminaryDateFilter || row.preliminaryDate === preliminaryDateFilter) &&
    (!measurementDateFilter || row.measurementDate === measurementDateFilter) &&
    (!surveyorFilter || row.surveyors.some((name) => name.includes(surveyorFilter))) &&
    (!methodFilter || row.surveyMethod === methodFilter),
  ), [drafts, kindFilter, measurementDateFilter, methodFilter, preliminaryDateFilter, rows, statusFilter, surveyorFilter]);

  const requestRecommendation = async (targetId?: number) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recommend", year, period, targetIds: targetId ? [targetId] : undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "추천 생성 실패");
      setDrafts((current) => {
        const next = new Map(current);
        for (const draft of result.drafts || []) next.set(draft.targetId, { ...rows.find((row) => row.targetId === draft.targetId), ...draft });
        return next;
      });
      setNotice(targetId
        ? `${result.impactSummary || "영향 범위를 재검증했습니다."} ${(result.drafts || []).length}개 변경안을 검토해 주세요.`
        : `${(result.drafts || []).length}개 임시 추천안을 생성했습니다. 아직 저장되지 않았습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천 생성 실패");
    } finally {
      setWorking(false);
    }
  };

  const applyDrafts = async () => {
    const targetIds = [...drafts.keys()].filter((id) => drafts.get(id)?.status === "recommended");
    if (!targetIds.length) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", drafts: targetIds.map((id) => drafts.get(id)) }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.reviewRequired) {
          const affected = new Set<number>((result.reasons || []).map((item: { targetId: number }) => Number(item.targetId)));
          setDrafts((current) => new Map([...current].map(([id, draft]) => [id, affected.has(id)
            ? { ...draft, status: "review_required" as const, conflict: "원천값 변경 · 새 추천 필요" }
            : draft])));
        }
        throw new Error(result.error || "추천안 적용 실패");
      }
      setDrafts(new Map());
      setNotice(`${result.appliedCount}개 변경사항을 가확정했습니다.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천안 적용 실패");
    } finally {
      setWorking(false);
    }
  };

  const openDetail = (row: WorkbenchRow) => {
    setSelected(row);
    setEditDate(row.preliminaryDate || "");
    setEditMethod(row.surveyMethod);
    setEditParticipants(users.filter((user) => row.surveyors.includes(user.name)).map((user) => user.id));
  };

  const saveManual = async () => {
    if (!selected || selected.locked) return;
    setWorking(true);
    try {
      const send = async (confirm: boolean) => fetch(`/api/preliminary-survey-v2/${selected.targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendedDate: editDate, surveyMethod: editMethod, participantUserIds: editParticipants, confirm }),
      });
      let response = await send(false);
      let result = await response.json();
      if (response.ok && result.requiresUserConfirmation && window.confirm(result.message)) {
        response = await send(true);
        result = await response.json();
      }
      if (!response.ok || !result.success) throw new Error(result.error || "수동 저장 실패");
      setSelected(null);
      setNotice("수동 수정 내용을 가확정했습니다.");
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수동 저장 실패");
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>;

  return (
    <div className="space-y-4">
      <Card className="overflow-x-auto p-3">
        <div data-testid={mode === "plan" ? "phase-b-plan-toolbar" : "phase-b-list-toolbar"} className={`flex items-end gap-2 ${mode === "plan" ? "min-w-[760px] flex-nowrap" : "flex-wrap xl:flex-nowrap"}`}>
          <label className="w-20 shrink-0 text-xs font-medium text-text-700">연도
            <input aria-label="연도" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
          </label>
          <label className="w-24 shrink-0 text-xs font-medium text-text-700">반기
            <select aria-label="반기" value={period} onChange={(event) => setPeriod(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
              <option value="">전체</option><option value="상반기">상반기</option><option value="하반기">하반기</option>
            </select>
          </label>
          <label className="w-28 shrink-0 text-xs font-medium text-text-700">상태
            <select aria-label="상태 필터" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
              <option value="">전체</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="w-28 shrink-0 text-xs font-medium text-text-700">구분
            <select aria-label="구분 필터" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
              <option value="">전체</option><option>최초실시</option><option>타기관 신규</option><option>기존업체</option>
            </select>
          </label>
          {mode === "list" && <>
            <label className="w-36 shrink-0 text-xs font-medium text-text-700">예비조사일
              <input aria-label="예비조사일" type="date" value={preliminaryDateFilter} onChange={(event) => setPreliminaryDateFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
            </label>
            <label className="w-36 shrink-0 text-xs font-medium text-text-700">측정예정일
              <input aria-label="측정예정일" type="date" value={measurementDateFilter} onChange={(event) => setMeasurementDateFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
            </label>
            <label className="w-24 shrink-0 text-xs font-medium text-text-700">조사자
              <input aria-label="조사자" value={surveyorFilter} onChange={(event) => setSurveyorFilter(event.target.value)} placeholder="이름" className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
            </label>
            <label className="w-20 shrink-0 text-xs font-medium text-text-700">방식
              <select aria-label="방식 필터" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm"><option value="">전체</option><option value="field">현장</option><option value="phone">유선</option></select>
            </label>
          </>}
          {mode === "plan" && <div className="ml-auto flex shrink-0 gap-2">
            <Button onClick={() => requestRecommendation()} disabled={working}>{drafts.size ? "새로 추천" : "추천 생성"}</Button>
            <Button variant="secondary" onClick={() => setNotice("행을 선택하면 추천 근거와 업체별 대안을 확인할 수 있습니다.")}>대안 보기</Button>
            <Button onClick={applyDrafts} disabled={working || drafts.size === 0}>추천안 적용</Button>
          </div>}
        </div>
      </Card>
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed text-sm">
            <thead className="bg-surface-50 text-left text-text-700">
              <tr>{["상태", "예비조사일", "코드", "사업장명", "구분", "측정예정일", "예비조사자", "방식", "메인측정자", "조력자", "보고서담당", "충돌"].map((label) => <th key={label} className="px-2 py-3 font-semibold first:w-24">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-surface-200">
              {displayRows.map((row) => (
                <tr key={row.targetId} onClick={() => openDetail(row)} className="cursor-pointer hover:bg-primary-50/40">
                  <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLES[row.status]}`}>{STATUS_LABELS[row.status]}</span></td>
                  <td className="px-2 py-2 whitespace-nowrap">{row.preliminaryDate || "-"}</td>
                  <td className="px-2 py-2 font-medium">{row.code}</td>
                  <td className="truncate px-2 py-2" title={row.businessName}>{row.businessName}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{row.kind}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{row.measurementDate || "-"}</td>
                  <td className="truncate px-2 py-2" title={row.surveyors.join(", ")}>{row.surveyors.join(", ") || "-"}</td>
                  <td className="px-2 py-2">{row.surveyMethod === "field" ? "현장" : "유선"}</td>
                  <td className="truncate px-2 py-2">{row.mainMeasurer || "-"}</td>
                  <td className="truncate px-2 py-2">{row.helper || "-"}</td>
                  <td className="truncate px-2 py-2">{row.reportWriter || "-"}</td>
                  <td className="truncate px-2 py-2 text-amber-700" title={row.conflict || ""}>{row.conflict || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayRows.length === 0 && <div className="p-10 text-center text-text-500">조건에 맞는 예비조사 대상이 없습니다.</div>}
        </div>
      </Card>

      {selected && <Modal isOpen onClose={() => setSelected(null)} title={`${selected.businessName} 예비조사 상세`} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-50 p-3 text-sm">
            <div>상태: <strong>{STATUS_LABELS[selected.status]}</strong></div><div>구분: <strong>{selected.kind}</strong></div>
            <div>측정예정일: <strong>{selected.measurementDate || "-"}</strong></div><div>충돌: <strong>{selected.conflict || "없음"}</strong></div>
          </div>
          {selected.reason && <Alert variant="warning">{selected.reason}</Alert>}
          {selected.alternatives && selected.alternatives.length > 0 && <div className="rounded-lg border border-surface-200 p-3 text-sm"><strong>대안 후보일</strong><div className="mt-1">{selected.alternatives.join(" · ")}</div></div>}
          <Input label="예비조사일" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} disabled={selected.locked} />
          <label className="block text-sm font-medium text-text-700">방식
            <select value={editMethod} onChange={(event) => setEditMethod(event.target.value as "field" | "phone")} disabled={selected.locked} className="mt-1 block h-10 w-full rounded-md border border-surface-300 bg-white px-3"><option value="field">현장</option><option value="phone">유선</option></select>
          </label>
          <fieldset disabled={selected.locked}><legend className="mb-2 text-sm font-medium text-text-700">예비조사자</legend><div className="grid grid-cols-2 gap-2">{users.filter((user) => user.is_active).map((user) => <label key={user.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editParticipants.includes(user.id)} onChange={() => setEditParticipants((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} />{user.name}{user.is_preliminary_survey_experienced ? " (경력)" : ""}</label>)}</div></fieldset>
          {selected.locked && <Alert variant="warning">유효한 측정일지가 있어 찐확정된 업체입니다. 일반 수정과 자동추천이 차단됩니다.</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => requestRecommendation(selected.targetId)} disabled={working || selected.locked}>이 업체 재추천</Button>
            <Button onClick={saveManual} disabled={working || selected.locked || !editDate || editParticipants.length === 0}>수동 저장</Button>
          </div>
        </div>
      </Modal>}
    </div>
  );
}
