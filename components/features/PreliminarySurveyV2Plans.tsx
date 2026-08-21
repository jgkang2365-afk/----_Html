"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import {
  getNextWeekRangeKst,
  recommendationRangeFromStartDate,
  validateRecommendationRange,
} from "@/lib/preliminary-survey-v2/recommendation-range";
import {
  collectWorkbenchRecommendationTargetIds,
  matchesWorkbenchSearch,
} from "@/lib/preliminary-survey-v2/workbench-search";

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

interface ListSearchSnapshot {
  year: number;
  period: string;
  statusFilter: string;
  kindFilter: string;
  preliminaryDateFilter: string;
  measurementDateFilter: string;
  methodFilter: string;
  searchQuery: string;
}

interface PlanSearchSnapshot {
  year: number;
  period: string;
  statusFilter: string;
  kindFilter: string;
  searchQuery: string;
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
  const [methodFilter, setMethodFilter] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [listSearchSnapshot, setListSearchSnapshot] = useState<ListSearchSnapshot>({
    year: currentYear,
    period: "",
    statusFilter: "",
    kindFilter: "",
    preliminaryDateFilter: "",
    measurementDateFilter: "",
    methodFilter: "",
    searchQuery: "",
  });
  const [planSearchSnapshot, setPlanSearchSnapshot] = useState<PlanSearchSnapshot>({
    year: currentYear,
    period: "",
    statusFilter: "",
    kindFilter: "",
    searchQuery: "",
  });
  const [preliminaryDateFrom, setPreliminaryDateFrom] = useState("");
  const [preliminaryDateTo, setPreliminaryDateTo] = useState("");
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<number>>(new Set());
  const [draftScope, setDraftScope] = useState<string | null>(null);
  const [scopeSummary, setScopeSummary] = useState<string | null>(null);
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

  const queryYear = mode === "list" ? listSearchSnapshot.year : planSearchSnapshot.year;
  const queryPeriod = mode === "list" ? listSearchSnapshot.period : planSearchSnapshot.period;

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(queryYear) });
      if (queryPeriod) params.set("period", queryPeriod);
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
  }, [queryPeriod, queryYear]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const activeStatusFilter = mode === "list" ? listSearchSnapshot.statusFilter : planSearchSnapshot.statusFilter;
  const activeKindFilter = mode === "list" ? listSearchSnapshot.kindFilter : planSearchSnapshot.kindFilter;
  const activePreliminaryDateFilter = mode === "list" ? listSearchSnapshot.preliminaryDateFilter : preliminaryDateFilter;
  const activeMeasurementDateFilter = mode === "list" ? listSearchSnapshot.measurementDateFilter : measurementDateFilter;
  const activeMethodFilter = mode === "list" ? listSearchSnapshot.methodFilter : methodFilter;
  const activeSearchQuery = mode === "list" ? listSearchSnapshot.searchQuery : planSearchSnapshot.searchQuery;

  const filteredRows = useMemo(() => rows.map((row) => drafts.get(row.targetId) ?? row).filter((row) =>
    (!activeStatusFilter || row.status === activeStatusFilter) &&
    (!activeKindFilter || row.kind === activeKindFilter) &&
    (!activePreliminaryDateFilter || row.preliminaryDate === activePreliminaryDateFilter) &&
    (!activeMeasurementDateFilter || row.measurementDate === activeMeasurementDateFilter) &&
    (!activeMethodFilter || row.surveyMethod === activeMethodFilter),
  ), [activeKindFilter, activeMeasurementDateFilter, activeMethodFilter, activePreliminaryDateFilter, activeStatusFilter, drafts, rows]);

  const displayRows = useMemo(
    () => filteredRows.filter((row) => matchesWorkbenchSearch(row, activeSearchQuery)),
    [activeSearchQuery, filteredRows],
  );

  const currentScope = useMemo(() => JSON.stringify({
    year: queryYear, period: queryPeriod,
    statusFilter: activeStatusFilter, kindFilter: activeKindFilter,
    preliminaryDateFilter: activePreliminaryDateFilter,
    measurementDateFilter: activeMeasurementDateFilter,
    methodFilter: activeMethodFilter,
    searchQuery: activeSearchQuery,
    preliminaryDateFrom, preliminaryDateTo,
    targetIds: [...selectedTargetIds].sort((a, b) => a - b),
  }), [activeKindFilter, activeMeasurementDateFilter, activeMethodFilter, activePreliminaryDateFilter, activeSearchQuery, activeStatusFilter, preliminaryDateFrom, preliminaryDateTo, queryPeriod, queryYear, selectedTargetIds]);

  const isPlanSearchDirty = mode === "plan" && (
    year !== planSearchSnapshot.year ||
    period !== planSearchSnapshot.period ||
    statusFilter !== planSearchSnapshot.statusFilter ||
    kindFilter !== planSearchSnapshot.kindFilter ||
    searchDraft !== planSearchSnapshot.searchQuery
  );

  const invalidateDrafts = (message = "추천 범위가 변경되어 새 추천이 필요합니다.") => {
    if (!drafts.size) return;
    setDrafts(new Map());
    setDraftScope(null);
    setScopeSummary(null);
    setNotice(message);
  };

  const changeScope = <T,>(setter: (value: T) => void, value: T) => {
    invalidateDrafts();
    setter(value);
  };

  const applyListSearch = () => {
    setListSearchSnapshot({
      year,
      period,
      statusFilter,
      kindFilter,
      preliminaryDateFilter,
      measurementDateFilter,
      methodFilter,
      searchQuery: searchDraft,
    });
  };

  const applyPlanSearch = () => {
    invalidateDrafts();
    setError(null);
    setNotice(null);
    setScopeSummary(null);
    setPlanSearchSnapshot({
      year,
      period,
      statusFilter,
      kindFilter,
      searchQuery: searchDraft,
    });
  };

  const selectedRows = useMemo(() => rows.filter((row) => selectedTargetIds.has(row.targetId)), [rows, selectedTargetIds]);
  const applicableDraftCount = useMemo(
    () => [...drafts.values()].filter((draft) => draft.status === "recommended").length,
    [drafts],
  );

  const setNextWeek = () => {
    const range = getNextWeekRangeKst(preliminaryDateFrom || undefined);
    invalidateDrafts();
    setPreliminaryDateFrom(range.startDate);
    setPreliminaryDateTo(range.endDate);
  };

  const changeRecommendationStartDate = (value: string) => {
    const range = recommendationRangeFromStartDate(value);
    invalidateDrafts();
    setPreliminaryDateFrom(range.startDate);
    setPreliminaryDateTo(range.endDate);
  };

  const requestRecommendation = async (targetId?: number) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const rangeError = validateRecommendationRange(preliminaryDateFrom, preliminaryDateTo);
      if (rangeError) throw new Error(rangeError);
      if (!targetId && isPlanSearchDirty) throw new Error("검색 조건이 변경되었습니다. 먼저 검색을 실행해 주세요.");
      const recommendationTargetIds = targetId
        ? [targetId]
        : collectWorkbenchRecommendationTargetIds(displayRows, selectedTargetIds);
      if (recommendationTargetIds.length === 0) {
        throw new Error("현재 필터와 선택 조건에 맞는 추천 대상이 없습니다.");
      }
      const response = await fetch("/api/preliminary-survey-v2/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recommend", year: queryYear, period: queryPeriod,
          targetIds: recommendationTargetIds,
          explicitTargetSelection: Boolean(targetId) || selectedTargetIds.size > 0,
          preliminaryDateFrom,
          preliminaryDateTo,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "추천 생성 실패");
      const generatedDrafts = result.drafts || [];
      const recommendedCount = generatedDrafts.filter((draft: WorkbenchRow) => draft.status === "recommended").length;
      const unavailableCount = generatedDrafts.length - recommendedCount + (result.missing || []).length;
      const dateScopeLabel = `${preliminaryDateFrom} ~ ${preliminaryDateTo}`;
      setDrafts((current) => {
        const next = new Map(current);
        for (const draft of generatedDrafts) next.set(draft.targetId, { ...rows.find((row) => row.targetId === draft.targetId), ...draft });
        return next;
      });
      setDraftScope(currentScope);
      setScopeSummary(`추천 범위: ${dateScopeLabel} · ${selectedTargetIds.size > 0 || targetId ? "선택 사업장" : "필터 대상"}: ${recommendationTargetIds.length}개 · 추천 생성: ${recommendedCount}개 · 추천 불가: ${unavailableCount}개`);
      setNotice(targetId
        ? `${result.impactSummary || "영향 범위를 재검증했습니다."} ${(result.drafts || []).length}개 변경안을 검토해 주세요.`
        : `추천 검토 결과: 추천 ${recommendedCount}개 · 조정 필요/불가 ${unavailableCount}개입니다. 아직 저장되지 않았습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천 생성 실패");
    } finally {
      setWorking(false);
    }
  };

  const applyDrafts = async () => {
    if (draftScope !== currentScope) {
      setError("추천 범위가 변경되었습니다. 새 추천안을 생성해 주세요.");
      return;
    }
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
      setDraftScope(null);
      setScopeSummary(null);
      setNotice(`${result.appliedCount}개 변경사항을 가확정했습니다.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천안 적용 실패");
    } finally {
      setWorking(false);
    }
  };

  const toggleTarget = (targetId: number) => {
    invalidateDrafts();
    setSelectedTargetIds((current) => {
      const next = new Set(current);
      if (next.has(targetId)) next.delete(targetId); else next.add(targetId);
      return next;
    });
  };

  const toggleDisplayedTargets = () => {
    invalidateDrafts();
    setSelectedTargetIds((current) => {
      const next = new Set(current);
      const allVisibleSelected = displayRows.length > 0 && displayRows.every((row) => next.has(row.targetId));
      for (const row of displayRows) allVisibleSelected ? next.delete(row.targetId) : next.add(row.targetId);
      return next;
    });
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
      <Card className="sticky top-28 z-30 bg-white p-3 shadow-sm">
        <div data-testid={mode === "plan" ? "phase-b-plan-toolbar" : "phase-b-list-toolbar"} className={mode === "plan" ? "grid w-full min-w-0 grid-cols-12 items-end gap-2" : "flex flex-wrap items-end gap-2"}>
          <label className={`${mode === "plan" ? "col-span-1 min-w-0" : "w-20 shrink-0"} text-xs font-medium text-text-700`}>연도
            <input aria-label="연도" type="number" value={year} onChange={(event) => changeScope(setYear, Number(event.target.value))} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
          </label>
          <label className={`${mode === "plan" ? "col-span-1 min-w-0" : "w-24 shrink-0"} text-xs font-medium text-text-700`}>반기
            <select aria-label="반기" value={period} onChange={(event) => changeScope(setPeriod, event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
              <option value="">전체</option><option value="상반기">상반기</option><option value="하반기">하반기</option>
            </select>
          </label>
          <label className={`${mode === "plan" ? "col-span-1 min-w-0" : "w-28 shrink-0"} text-xs font-medium text-text-700`}>상태
            <select aria-label="상태 필터" value={statusFilter} onChange={(event) => changeScope(setStatusFilter, event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
              <option value="">전체</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={`${mode === "plan" ? "col-span-1 min-w-0" : "w-28 shrink-0"} text-xs font-medium text-text-700`}>구분
            <select aria-label="구분 필터" value={kindFilter} onChange={(event) => changeScope(setKindFilter, event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
              <option value="">전체</option><option>최초실시</option><option>타기관 신규</option><option>기존업체</option>
            </select>
          </label>
          {mode === "plan" && <>
            <label className="col-span-1 min-w-0 text-xs font-medium text-text-700">시작일
              <input aria-label="추천 시작일" type="date" value={preliminaryDateFrom} onChange={(event) => changeRecommendationStartDate(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
            </label>
            <label className="col-span-1 min-w-0 text-xs font-medium text-text-700">종료일
              <input aria-label="추천 종료일" type="date" value={preliminaryDateTo} onChange={(event) => changeScope(setPreliminaryDateTo, event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
            </label>
            <div className="col-span-1 flex min-w-0 items-end"><Button className="h-9 w-full !bg-orange-500 px-2 text-xs hover:!bg-orange-600 focus-visible:!ring-orange-500" onClick={setNextWeek}>다음 주</Button></div>
            <label className="col-span-4 min-w-0 text-xs font-medium text-text-700">코드 · 사업장명
              <textarea aria-label="코드 또는 사업장명 검색" rows={1} value={searchDraft} onChange={(event) => changeScope(setSearchDraft, event.target.value)} placeholder="부분/정확, 쉼표·줄바꿈 구분" className="mt-1 block h-9 min-w-0 w-full resize-none rounded-md border border-surface-300 bg-white px-2 py-2 text-sm" />
            </label>
            <div className="col-span-1 flex min-w-0 items-end"><Button className="h-9 w-full px-2 text-xs" onClick={applyPlanSearch}>검색</Button></div>
          </>}
          {mode === "list" && <>
            <label className="w-36 shrink-0 text-xs font-medium text-text-700">예비조사일
              <input aria-label="예비조사일" type="date" value={preliminaryDateFilter} onChange={(event) => setPreliminaryDateFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
            </label>
            <label className="w-36 shrink-0 text-xs font-medium text-text-700">측정예정일
              <input aria-label="측정예정일" type="date" value={measurementDateFilter} onChange={(event) => setMeasurementDateFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm" />
            </label>
            <label className="w-20 shrink-0 text-xs font-medium text-text-700">방식
              <select aria-label="방식 필터" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm"><option value="">전체</option><option value="field">현장</option><option value="phone">유선</option></select>
            </label>
            <label className="min-w-[14rem] flex-1 text-xs font-medium text-text-700">코드 · 사업장명
              <textarea aria-label="코드 또는 사업장명 검색" rows={1} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="부분/정확, 쉼표·줄바꿈 구분" className="mt-1 block h-9 w-full resize-none rounded-md border border-surface-300 bg-white px-2 py-2 text-sm" />
            </label>
            <div className="flex shrink-0 items-end"><Button className="h-9 px-3 text-xs" onClick={applyListSearch}>검색</Button></div>
          </>}
          {mode === "plan" && <>
            <div className="col-span-7 flex min-w-0 items-center gap-1 border-t border-surface-100 pt-2 text-xs text-text-600"><span>검색 결과 {displayRows.length}건 · 선택 {selectedTargetIds.size}건</span>{isPlanSearchDirty && <span className="text-amber-700">검색 조건 변경 · 검색 필요</span>}{selectedRows.slice(0, 4).map((row) => <span key={row.targetId} className="flex max-w-36 items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><span className="truncate">{row.code} {row.businessName}</span><button aria-label={`${row.businessName} 선택 해제`} onClick={() => toggleTarget(row.targetId)}>×</button></span>)}{selectedTargetIds.size > 4 && <span>외 {selectedTargetIds.size - 4}건</span>}{selectedTargetIds.size > 0 && <button className="ml-1 text-primary-700 underline" onClick={() => { invalidateDrafts(); setSelectedTargetIds(new Set()); }}>전체 해제</button>}</div>
            <div className="col-span-5 flex shrink-0 justify-end gap-2 border-t border-surface-100 pt-2">
              <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => requestRecommendation()} disabled={working || isPlanSearchDirty}>{drafts.size ? "새로 추천" : "추천 생성"}</Button>
              <Button size="sm" className="shrink-0 whitespace-nowrap" variant="secondary" onClick={() => setNotice("행을 선택하면 추천 근거와 업체별 대안을 확인할 수 있습니다.")} disabled={isPlanSearchDirty}>대안 보기</Button>
              <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={applyDrafts} disabled={working || isPlanSearchDirty || applicableDraftCount === 0 || draftScope !== currentScope}>추천안 적용</Button>
            </div>
          </>}
        </div>
      </Card>
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {scopeSummary && <div className="text-xs text-text-600">{scopeSummary}</div>}
      <Card className="overflow-hidden">
        <div data-testid={mode === "plan" ? "phase-b-plan-table-scroll" : "phase-b-list-table-scroll"} className="max-h-[calc(100vh-20rem)] overflow-auto">
          <table className="w-full min-w-[1080px] table-fixed text-sm">
            <thead className="sticky top-0 z-20 bg-surface-50 text-left text-text-700 shadow-sm">
              <tr>{mode === "plan" && <th className="w-9 px-2 py-3"><input aria-label="표시 대상 전체 선택" type="checkbox" checked={displayRows.length > 0 && displayRows.every((row) => selectedTargetIds.has(row.targetId))} onChange={toggleDisplayedTargets} /></th>}{["상태", "예비조사일", "코드", "사업장명", "구분", "측정예정일", "예비조사자", "방식", "메인측정자", "조력자", "보고서담당", "충돌"].map((label) => <th key={label} className="px-2 py-3 font-semibold first:w-24">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-surface-200">
              {displayRows.map((row) => (
                <tr key={row.targetId} onClick={() => openDetail(row)} className="cursor-pointer hover:bg-primary-50/40">
                  {mode === "plan" && <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}><input aria-label={`${row.businessName} 선택`} type="checkbox" checked={selectedTargetIds.has(row.targetId)} onChange={() => toggleTarget(row.targetId)} /></td>}
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
