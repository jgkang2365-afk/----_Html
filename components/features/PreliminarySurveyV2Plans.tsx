"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import { FixedAssigneeReversePlanner } from "@/components/features/FixedAssigneeReversePlanner";
import { formatPreliminarySurveyParticipantsForDisplay } from "@/lib/preliminary-survey-v2/participant-display";
import {
  adjacentMeasurementReferenceDate,
  currentDateInKst,
  measurementRangeFromReference,
  type MeasurementRangeUnit,
} from "@/lib/preliminary-survey-v2/recommendation-range";
import {
  collectWorkbenchRecommendationTargetIds,
  matchesMeasurementDateRange,
  matchesWorkbenchSearch,
} from "@/lib/preliminary-survey-v2/workbench-search";
import type {
  CanonicalMeasurementAssignmentDraft,
  RecommendationScopeSnapshot,
} from "@/lib/preliminary-survey-v2/draft-canonical";

type WorkbenchStatus = "unassigned" | "recommended" | "confirmed_repair" | "adjustment_required" | "provisional" | "review_required" | "true_confirmed";

interface ConfirmedRepairDraft {
  targetId: number;
  classification: "MISSING_DOCUMENTARY_INFO" | "PROTECTED_MANUAL" | "NEEDS_MANUAL_REVIEW";
  fillDate: boolean;
  fillSurveyors: boolean;
  recommendedDate: string | null;
  responsibleUserId: number | null;
  experiencedReviewerUserId: number | null;
  participantUserIds: number[];
  participantNames: string[];
  surveyMethod: "field" | "phone" | null;
  sourceMeasurementDate: string;
  sourceMeasurerId: number | null;
  sourceRuleType: "new" | "existing" | null;
  reason: string;
  existingPlanId: string | null;
  code: string;
  businessName: string;
}

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
  measurementParticipants?: string;
  reportWriter?: string;
  measurementAssigneeUserId?: number;
  measurementAssigneeName?: string;
  publicSampleCode?: string;
  measurementAssignmentApprovalRequired?: boolean;
  /** 서버 재추천 전체 snapshot hash. apply 시 임의 수정 draft를 거부한다. */
  canonicalFingerprint?: string;
  recommendationScope?: RecommendationScopeSnapshot;
  measurementAssignments?: CanonicalMeasurementAssignmentDraft[];
  recommendationReasons?: string[];
  status: WorkbenchStatus;
  conflict: string | null;
  conflicts?: string[];
  reason?: string;
  alternatives?: string[];
  hasPersistedPlan?: boolean;
  locked?: boolean;
  deleteProtectionReason?: "history" | null;
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
  methodFilter: string;
  measurementBaseDate: string;
  measurementRangeUnit: MeasurementRangeUnit;
  measurementDateFrom: string;
  measurementDateTo: string;
  searchQuery: string;
}

interface PlanSearchSnapshot {
  year: number;
  period: string;
  statusFilter: string;
  kindFilter: string;
  measurementBaseDate: string;
  measurementRangeUnit: MeasurementRangeUnit;
  measurementDateFrom: string;
  measurementDateTo: string;
  searchQuery: string;
}

export const PRELIMINARY_SURVEY_PLAN_FILTERS_STORAGE_KEY = "preliminarySurveyV2PlanFiltersV2";
export const PRELIMINARY_SURVEY_LIST_FILTERS_STORAGE_KEY = "preliminarySurveyV2ListFiltersV2";

function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isRangeUnit(value: unknown): value is MeasurementRangeUnit {
  return value === "day" || value === "week" || value === "month";
}

function restoreSearchSnapshot<T extends PlanSearchSnapshot | ListSearchSnapshot>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const measurementBaseDate = isDateOnly(parsed.measurementBaseDate)
      ? parsed.measurementBaseDate
      : fallback.measurementBaseDate;
    const measurementRangeUnit = isRangeUnit(parsed.measurementRangeUnit)
      ? parsed.measurementRangeUnit
      : fallback.measurementRangeUnit;
    const range = measurementRangeFromReference(measurementBaseDate, measurementRangeUnit);
    const common = {
      ...fallback,
      year: Number.isInteger(parsed.year) && Number(parsed.year) >= 2000 && Number(parsed.year) <= 2100
        ? Number(parsed.year)
        : fallback.year,
      period: parsed.period === "상반기" || parsed.period === "하반기" || parsed.period === "" ? parsed.period : fallback.period,
      statusFilter: typeof parsed.statusFilter === "string" ? parsed.statusFilter : fallback.statusFilter,
      kindFilter: typeof parsed.kindFilter === "string" ? parsed.kindFilter : fallback.kindFilter,
      measurementBaseDate,
      measurementRangeUnit,
      measurementDateFrom: range.startDate,
      measurementDateTo: range.endDate,
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : fallback.searchQuery,
    };
    if ("preliminaryDateFilter" in fallback) {
      return {
        ...common,
        preliminaryDateFilter: isDateOnly(parsed.preliminaryDateFilter) ? parsed.preliminaryDateFilter : "",
        methodFilter: typeof parsed.methodFilter === "string" ? parsed.methodFilter : fallback.methodFilter,
      } as T;
    }
    return common as T;
  } catch {
    return fallback;
  }
}

const STATUS_LABELS: Record<WorkbenchStatus, string> = {
  unassigned: "미추천",
  recommended: "추천",
  confirmed_repair: "누락 보정안",
  adjustment_required: "조정 필요",
  provisional: "가확정",
  review_required: "재검토 필요",
  true_confirmed: "확정",
};

const STATUS_STYLES: Record<WorkbenchStatus, string> = {
  unassigned: "bg-slate-100 text-slate-700",
  recommended: "bg-blue-100 text-blue-700",
  confirmed_repair: "bg-cyan-100 text-cyan-800",
  adjustment_required: "bg-amber-100 text-amber-800",
  provisional: "bg-emerald-100 text-emerald-800",
  review_required: "bg-orange-100 text-orange-800",
  true_confirmed: "bg-purple-100 text-purple-800",
};

export function PreliminarySurveyV2Plans({ mode = "plan" }: { mode?: "plan" | "list" }) {
  const initialMeasurementBaseDate = currentDateInKst();
  const currentYear = Number(initialMeasurementBaseDate.slice(0, 4));
  const initialRange = measurementRangeFromReference(initialMeasurementBaseDate, "day");
  const [year, setYear] = useState(currentYear);
  const [period, setPeriod] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [preliminaryDateFilter, setPreliminaryDateFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [measurementBaseDate, setMeasurementBaseDate] = useState(initialMeasurementBaseDate);
  const [measurementRangeUnit, setMeasurementRangeUnit] = useState<MeasurementRangeUnit>("day");
  const [searchDraft, setSearchDraft] = useState("");
  const [listSearchSnapshot, setListSearchSnapshot] = useState<ListSearchSnapshot>({
    year: currentYear,
    period: "",
    statusFilter: "",
    kindFilter: "",
    preliminaryDateFilter: "",
    methodFilter: "",
    measurementBaseDate: initialMeasurementBaseDate,
    measurementRangeUnit: "day",
    measurementDateFrom: initialRange.startDate,
    measurementDateTo: initialRange.endDate,
    searchQuery: "",
  });
  const [planSearchSnapshot, setPlanSearchSnapshot] = useState<PlanSearchSnapshot>({
    year: currentYear,
    period: "",
    statusFilter: "",
    kindFilter: "",
    measurementBaseDate: initialMeasurementBaseDate,
    measurementRangeUnit: "day",
    measurementDateFrom: initialRange.startDate,
    measurementDateTo: initialRange.endDate,
    searchQuery: "",
  });
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<number>>(new Set());
  const [draftScope, setDraftScope] = useState<string | null>(null);
  const [scopeSummary, setScopeSummary] = useState<string | null>(null);
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const [drafts, setDrafts] = useState<Map<number, WorkbenchRow>>(new Map());
  const [confirmedRepairDrafts, setConfirmedRepairDrafts] = useState<ConfirmedRepairDraft[]>([]);
  const [users, setUsers] = useState<SurveyUser[]>([]);
  const [selected, setSelected] = useState<WorkbenchRow | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isAutoAssignmentOpen, setIsAutoAssignmentOpen] = useState(false);
  const hasLoadedRef = useRef(false);
  const lastCommittedSearchRef = useRef("");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(mode === "plan" ? 108 : 78);
  const [stickyBaseTop, setStickyBaseTop] = useState(160);

  useEffect(() => {
    const defaultPlan: PlanSearchSnapshot = {
      year: currentYear, period: "", statusFilter: "", kindFilter: "",
      measurementBaseDate: initialMeasurementBaseDate, measurementRangeUnit: "day",
      measurementDateFrom: initialRange.startDate, measurementDateTo: initialRange.endDate, searchQuery: "",
    };
    const defaultList: ListSearchSnapshot = {
      year: currentYear, period: "", statusFilter: "", kindFilter: "", preliminaryDateFilter: "", methodFilter: "",
      measurementBaseDate: initialMeasurementBaseDate, measurementRangeUnit: "day",
      measurementDateFrom: initialRange.startDate, measurementDateTo: initialRange.endDate, searchQuery: "",
    };
    const restored = mode === "plan"
      ? restoreSearchSnapshot(PRELIMINARY_SURVEY_PLAN_FILTERS_STORAGE_KEY, defaultPlan)
      : restoreSearchSnapshot(PRELIMINARY_SURVEY_LIST_FILTERS_STORAGE_KEY, defaultList);
    setYear(restored.year);
    setPeriod(restored.period);
    setStatusFilter(restored.statusFilter);
    setKindFilter(restored.kindFilter);
    setMeasurementBaseDate(restored.measurementBaseDate);
    setMeasurementRangeUnit(restored.measurementRangeUnit);
    setSearchDraft(restored.searchQuery);
    lastCommittedSearchRef.current = restored.searchQuery;
    if (mode === "plan") {
      setPlanSearchSnapshot(restored as PlanSearchSnapshot);
    } else {
      const restoredList = restored as ListSearchSnapshot;
      setPreliminaryDateFilter(restoredList.preliminaryDateFilter);
      setMethodFilter(restoredList.methodFilter);
      setListSearchSnapshot(restoredList);
    }
    setFiltersReady(true);
  // 최초 mount에서만 현재 KST 기본값 또는 저장 조건을 복원한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!filtersReady || loading) return;
    const element = toolbarRef.current;
    if (!element) return;
    const updateHeight = () => setToolbarHeight(Math.ceil(element.getBoundingClientRect().height));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [filtersReady, loading, mode]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const updateStickyBaseTop = () => setStickyBaseTop(desktop.matches ? 160 : 112);
    updateStickyBaseTop();
    desktop.addEventListener("change", updateStickyBaseTop);
    return () => desktop.removeEventListener("change", updateStickyBaseTop);
  }, []);

  const queryYear = mode === "list" ? listSearchSnapshot.year : planSearchSnapshot.year;
  const queryPeriod = mode === "list" ? listSearchSnapshot.period : planSearchSnapshot.period;

  const loadRows = useCallback(async () => {
    if (hasLoadedRef.current) setRefreshing(true); else setLoading(true);
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
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [queryPeriod, queryYear]);

  const experienceByName = useMemo(() => new Map(users.map((user) => [
    user.name,
    user.is_preliminary_survey_experienced,
  ] as const)), [users]);
  const displaySurveyors = useCallback((names: string[]) => formatPreliminarySurveyParticipantsForDisplay(
    names.map((name) => ({ name, experienced: experienceByName.get(name) })),
  ), [experienceByName]);

  useEffect(() => {
    if (!filtersReady) return;
    void loadRows();
  }, [filtersReady, loadRows]);

  const activeStatusFilter = mode === "list" ? listSearchSnapshot.statusFilter : planSearchSnapshot.statusFilter;
  const activeKindFilter = mode === "list" ? listSearchSnapshot.kindFilter : planSearchSnapshot.kindFilter;
  const activePreliminaryDateFilter = mode === "list" ? listSearchSnapshot.preliminaryDateFilter : preliminaryDateFilter;
  const activeMeasurementDateFrom = mode === "plan" ? planSearchSnapshot.measurementDateFrom : listSearchSnapshot.measurementDateFrom;
  const activeMeasurementDateTo = mode === "plan" ? planSearchSnapshot.measurementDateTo : listSearchSnapshot.measurementDateTo;
  const activeMethodFilter = mode === "list" ? listSearchSnapshot.methodFilter : methodFilter;
  const activeSearchQuery = mode === "list" ? listSearchSnapshot.searchQuery : planSearchSnapshot.searchQuery;

  const filteredRows = useMemo(() => rows.map((row) => drafts.get(row.targetId) ?? row).filter((row) =>
    (!activeStatusFilter || row.status === activeStatusFilter) &&
    (!activeKindFilter || row.kind === activeKindFilter) &&
    (!activePreliminaryDateFilter || row.preliminaryDate === activePreliminaryDateFilter) &&
    matchesMeasurementDateRange(row.measurementDate, activeMeasurementDateFrom, activeMeasurementDateTo) &&
    (!activeMethodFilter || row.surveyMethod === activeMethodFilter),
  ), [activeKindFilter, activeMeasurementDateFrom, activeMeasurementDateTo, activeMethodFilter, activePreliminaryDateFilter, activeStatusFilter, drafts, rows]);

  const displayRows = useMemo(
    () => filteredRows.filter((row) => matchesWorkbenchSearch(row, activeSearchQuery)),
    [activeSearchQuery, filteredRows],
  );

  const currentScope = useMemo(() => JSON.stringify({
    year: queryYear, period: queryPeriod,
    statusFilter: activeStatusFilter, kindFilter: activeKindFilter,
    preliminaryDateFilter: activePreliminaryDateFilter,
    measurementDateFrom: activeMeasurementDateFrom,
    measurementDateTo: activeMeasurementDateTo,
    measurementBaseDate: mode === "plan" ? planSearchSnapshot.measurementBaseDate : listSearchSnapshot.measurementBaseDate,
    measurementRangeUnit: mode === "plan" ? planSearchSnapshot.measurementRangeUnit : listSearchSnapshot.measurementRangeUnit,
    methodFilter: activeMethodFilter,
    searchQuery: activeSearchQuery,
    targetIds: [...selectedTargetIds].sort((a, b) => a - b),
  }), [activeKindFilter, activeMeasurementDateFrom, activeMeasurementDateTo, activeMethodFilter, activePreliminaryDateFilter, activeSearchQuery, activeStatusFilter, listSearchSnapshot.measurementBaseDate, listSearchSnapshot.measurementRangeUnit, mode, planSearchSnapshot.measurementBaseDate, planSearchSnapshot.measurementRangeUnit, queryPeriod, queryYear, selectedTargetIds]);

  const isPlanSearchDirty = mode === "plan" && (
    year !== planSearchSnapshot.year ||
    period !== planSearchSnapshot.period ||
    statusFilter !== planSearchSnapshot.statusFilter ||
    kindFilter !== planSearchSnapshot.kindFilter ||
    measurementBaseDate !== planSearchSnapshot.measurementBaseDate ||
    measurementRangeUnit !== planSearchSnapshot.measurementRangeUnit ||
    searchDraft !== planSearchSnapshot.searchQuery
  );

  const invalidateDrafts = (message = "추천 범위가 변경되어 새 추천이 필요합니다.") => {
    if (!drafts.size && !confirmedRepairDrafts.length) return;
    setDrafts(new Map());
    setConfirmedRepairDrafts([]);
    setDraftScope(null);
    setScopeSummary(null);
    setNotice(message);
  };

  const changeScope = <T,>(setter: (value: T) => void, value: T) => {
    invalidateDrafts();
    setter(value);
  };

  useEffect(() => {
    if (!filtersReady) return;
    const range = measurementRangeFromReference(measurementBaseDate, measurementRangeUnit);
    if (mode === "plan") {
      const changed = year !== planSearchSnapshot.year || period !== planSearchSnapshot.period
        || statusFilter !== planSearchSnapshot.statusFilter || kindFilter !== planSearchSnapshot.kindFilter
        || measurementBaseDate !== planSearchSnapshot.measurementBaseDate
        || measurementRangeUnit !== planSearchSnapshot.measurementRangeUnit;
      if (!changed) return;
      invalidateDrafts();
      setPlanSearchSnapshot((current) => ({
        ...current, year, period, statusFilter, kindFilter, measurementBaseDate, measurementRangeUnit,
        measurementDateFrom: range.startDate, measurementDateTo: range.endDate,
      }));
      return;
    }
    const changed = year !== listSearchSnapshot.year || period !== listSearchSnapshot.period
      || statusFilter !== listSearchSnapshot.statusFilter || kindFilter !== listSearchSnapshot.kindFilter
      || preliminaryDateFilter !== listSearchSnapshot.preliminaryDateFilter
      || methodFilter !== listSearchSnapshot.methodFilter
      || measurementBaseDate !== listSearchSnapshot.measurementBaseDate
      || measurementRangeUnit !== listSearchSnapshot.measurementRangeUnit;
    if (!changed) return;
    setListSearchSnapshot((current) => ({
      ...current, year, period, statusFilter, kindFilter, preliminaryDateFilter, methodFilter,
      measurementBaseDate, measurementRangeUnit,
      measurementDateFrom: range.startDate, measurementDateTo: range.endDate,
    }));
  // 검색어를 제외한 조회조건은 변경 즉시 active snapshot에 반영한다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersReady, kindFilter, measurementBaseDate, measurementRangeUnit, methodFilter, mode, period, preliminaryDateFilter, statusFilter, year]);

  useEffect(() => {
    if (!filtersReady) return;
    const snapshot = mode === "plan" ? planSearchSnapshot : listSearchSnapshot;
    const stored = {
      year: snapshot.year,
      period: snapshot.period,
      statusFilter: snapshot.statusFilter,
      kindFilter: snapshot.kindFilter,
      ...(mode === "list" ? {
        preliminaryDateFilter: listSearchSnapshot.preliminaryDateFilter,
        methodFilter: listSearchSnapshot.methodFilter,
      } : {}),
      measurementBaseDate: snapshot.measurementBaseDate,
      measurementRangeUnit: snapshot.measurementRangeUnit,
      searchQuery: snapshot.searchQuery,
    };
    window.localStorage.setItem(
      mode === "plan" ? PRELIMINARY_SURVEY_PLAN_FILTERS_STORAGE_KEY : PRELIMINARY_SURVEY_LIST_FILTERS_STORAGE_KEY,
      JSON.stringify(stored),
    );
  }, [filtersReady, listSearchSnapshot, mode, planSearchSnapshot]);

  useEffect(() => {
    lastCommittedSearchRef.current = activeSearchQuery;
  }, [activeSearchQuery]);

  const commitSearch = () => {
    if (lastCommittedSearchRef.current === searchDraft) return;
    invalidateDrafts();
    lastCommittedSearchRef.current = searchDraft;
    if (mode === "plan") {
      setPlanSearchSnapshot((current) => ({ ...current, searchQuery: searchDraft }));
    } else {
      setListSearchSnapshot((current) => ({ ...current, searchQuery: searchDraft }));
    }
  };

  const updateMeasurementBaseDate = (nextDate: string) => {
    if (!nextDate) return;
    invalidateDrafts();
    setMeasurementBaseDate(nextDate);
    setYear(Number(nextDate.slice(0, 4)));
    if (period) setPeriod(Number(nextDate.slice(5, 7)) <= 6 ? "상반기" : "하반기");
  };

  const moveMeasurementRange = (direction: -1 | 1) => {
    updateMeasurementBaseDate(adjacentMeasurementReferenceDate(measurementBaseDate, measurementRangeUnit, direction));
  };

  const changeMeasurementRangeUnit = (unit: MeasurementRangeUnit) => {
    invalidateDrafts();
    setMeasurementRangeUnit(unit);
  };

  const applicableDraftCount = useMemo(
    () => [...drafts.values()].filter((draft) => draft.status === "recommended").length,
    [drafts],
  );

  const requestRecommendation = async (targetId?: number) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
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
          measurementDateFrom: planSearchSnapshot.measurementDateFrom || undefined,
          measurementDateTo: planSearchSnapshot.measurementDateTo || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "배정안 계산 실패");
      const generatedDrafts = result.drafts || [];
      const recommendedCount = generatedDrafts.filter((draft: WorkbenchRow) => draft.status === "recommended").length;
      const unavailableCount = generatedDrafts.length - recommendedCount + (result.missing || []).length;
      const repairResponse = await fetch("/api/preliminary-survey-v2/confirmed-document-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", targetIds: recommendationTargetIds }),
      });
      const repairResult = await repairResponse.json();
      if (!repairResponse.ok) throw new Error(repairResult.error || "확정 자료 누락정보 보정안 생성 실패");
      const repairDrafts = (repairResult.drafts || []) as ConfirmedRepairDraft[];
      const repairableDrafts = repairDrafts.filter((draft) => draft.classification === "MISSING_DOCUMENTARY_INFO");
      setConfirmedRepairDrafts(repairableDrafts);
      const dateScopeLabel = `${planSearchSnapshot.measurementDateFrom} ~ ${planSearchSnapshot.measurementDateTo}`;
      setDrafts((current) => {
        const next = new Map(current);
        for (const draft of generatedDrafts) next.set(draft.targetId, { ...rows.find((row) => row.targetId === draft.targetId), ...draft });
        for (const repair of repairDrafts) {
          const base = rows.find((row) => row.targetId === repair.targetId);
          if (!base) continue;
          const warning = repair.classification === "MISSING_DOCUMENTARY_INFO"
            ? "확정 자료 누락정보 보정안 · 별도 확인 필요" : repair.reason;
          const conflicts = [...new Set([...(base.conflicts ?? (base.conflict ? [base.conflict] : [])), warning])];
          next.set(repair.targetId, {
            ...base,
            preliminaryDate: repair.recommendedDate ?? base.preliminaryDate,
            surveyors: repair.participantNames.length ? repair.participantNames : base.surveyors,
            surveyMethod: repair.surveyMethod ?? base.surveyMethod,
            status: repair.classification === "MISSING_DOCUMENTARY_INFO" ? "confirmed_repair" : "review_required",
            conflict: conflicts.join(" · "),
            conflicts,
          });
        }
        return next;
      });
      setDraftScope(currentScope);
      const manualReviewCount = Number(repairResult.manualReviewCount || 0) + unavailableCount;
      setScopeSummary(`측정예정일 범위: ${dateScopeLabel} · 대상 ${recommendationTargetIds.length}개 · 일반 배정 ${recommendedCount}건 · 확정 자료 누락 보정안 ${repairableDrafts.length}건 · 변경 없음 ${Number(repairResult.unchangedCount || 0)}건 · 수동 확인 필요 ${manualReviewCount}건`);
      setNotice(targetId
        ? `${result.impactSummary || "영향 범위를 재검증했습니다."} 일반 배정과 확정 자료 누락 보정안을 구분해 검토해 주세요.`
        : `일반 배정 ${recommendedCount}건 · 확정 자료 누락정보 보정 ${repairableDrafts.length}건 · 변경 없음 ${Number(repairResult.unchangedCount || 0)}건 · 수동 확인 필요 ${manualReviewCount}건입니다. 아직 저장되지 않았습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "배정안 계산 실패");
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
      const send = (approveThirdAssignment: boolean) => fetch("/api/preliminary-survey-v2/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", drafts: targetIds.map((id) => drafts.get(id)), approveThirdAssignment }),
      });
      let response = await send(false);
      let result = await response.json();
      if (response.status === 409 && result.approvalRequired && window.confirm(`${result.error}\n승인하여 적용하시겠습니까?`)) {
        response = await send(true);
        result = await response.json();
      }
      if (!response.ok) {
        if (result.reviewRequired) {
          const affected = new Set<number>((result.reasons || []).map((item: { targetId: number }) => Number(item.targetId)));
          setDrafts((current) => new Map([...current].map(([id, draft]) => [id, affected.has(id)
            ? { ...draft, status: "review_required" as const, conflict: "원천값 변경 · 새 추천 필요" }
            : draft])));
        }
        throw new Error(result.error || "배정 확정 실패");
      }
      setDrafts(new Map());
      setConfirmedRepairDrafts([]);
      setDraftScope(null);
      setScopeSummary(null);
      setNotice(`${result.appliedCount}개 변경사항을 가확정했습니다.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "배정 확정 실패");
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
  };

  const applyConfirmedRepairs = async () => {
    if (!confirmedRepairDrafts.length || draftScope !== currentScope) return;
    if (!window.confirm(`확정 계획 ${confirmedRepairDrafts.length}건의 누락된 예비조사 정보만 보정하시겠습니까?\n기존 값과 측정 원천은 변경되지 않습니다.`)) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/confirmed-document-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          targetIds: confirmedRepairDrafts.map((draft) => draft.targetId),
          drafts: confirmedRepairDrafts,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "확정 자료 누락정보 보정 실패");
      setDrafts(new Map());
      setConfirmedRepairDrafts([]);
      setDraftScope(null);
      setScopeSummary(null);
      setNotice(`확정 자료 누락정보 ${result.repairedCount}건을 보정했습니다.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "확정 자료 누락정보 보정 실패");
    } finally {
      setWorking(false);
    }
  };

  const deletePlan = async (row: WorkbenchRow) => {
    if (!row.hasPersistedPlan || row.locked || row.deleteProtectionReason) return;
    const confirmed = window.confirm(
      `${row.businessName}의 예비조사 계획을 삭제하시겠습니까?\n` +
      "예비조사일, 조사자와 해당 계획의 측정자(공시료) 배정이 함께 삭제됩니다.\n" +
      "측정대상 사업장 자체와 측정예정일은 삭제되지 않습니다.",
    );
    if (!confirmed) return;

    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const send = (approveThirdAssignment: boolean) => fetch(`/api/preliminary-survey-v2/${row.targetId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approveThirdAssignment }),
      });
      let response = await send(false);
      let result = await response.json();
      if (response.status === 409 && result.approvalRequired && window.confirm(
        "계획 삭제 후 해당 측정자의 배정이 3건이 되어 승인이 필요합니다.\n승인하고 삭제하시겠습니까?",
      )) {
        response = await send(true);
        result = await response.json();
      }
      if (!response.ok || !result.success) throw new Error(result.error || "예비조사 계획 삭제 실패");

      setSelected(null);
      setDrafts(new Map());
      setConfirmedRepairDrafts([]);
      setDraftScope(null);
      setScopeSummary(null);
      setNotice("예비조사 계획을 삭제했습니다. 측정예정일을 변경한 뒤 새로 추천해 주세요.");
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예비조사 계획 삭제 실패");
    } finally {
      setWorking(false);
    }
  };

  const navigationUnitLabel = measurementRangeUnit === "day" ? "일" : measurementRangeUnit === "week" ? "주" : "월";
  const tableHeaderTop = stickyBaseTop + toolbarHeight;
  const filterControlClass = "mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";
  const commitSearchOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitSearch();
  };

  if (!filtersReady || loading) return <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>;

  return (
    <div className="space-y-4">
      <Card ref={toolbarRef} className="sticky top-28 z-30 bg-white p-3 shadow-sm lg:top-40">
        <div data-testid={mode === "plan" ? "phase-b-plan-toolbar" : "phase-b-list-toolbar"}>
          {mode === "plan" ? <div className="flex flex-wrap items-end gap-2 xl:flex-nowrap">
            <label className="w-[68px] shrink-0 text-xs font-medium text-text-700">연도<input aria-label="연도" type="number" value={year} onChange={(event) => changeScope(setYear, Number(event.target.value))} className={filterControlClass} /></label>
            <label className="w-[76px] shrink-0 text-xs font-medium text-text-700">반기<select aria-label="반기" value={period} onChange={(event) => changeScope(setPeriod, event.target.value)} className={filterControlClass}><option value="">전체</option><option value="상반기">상반기</option><option value="하반기">하반기</option></select></label>
            <label className="w-[92px] shrink-0 text-xs font-medium text-text-700">상태<select aria-label="상태 필터" value={statusFilter} onChange={(event) => changeScope(setStatusFilter, event.target.value)} className={filterControlClass}><option value="">전체</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="w-[96px] shrink-0 text-xs font-medium text-text-700">구분<select aria-label="구분 필터" value={kindFilter} onChange={(event) => changeScope(setKindFilter, event.target.value)} className={filterControlClass}><option value="">전체</option><option>최초실시</option><option>타기관 신규</option><option>기존업체</option></select></label>
            <label className="w-[132px] shrink-0 text-xs font-medium text-text-700">측정 기준일<input aria-label="측정 기준일" type="date" value={measurementBaseDate} onChange={(event) => updateMeasurementBaseDate(event.target.value)} className={filterControlClass} /></label>
            <div className="flex shrink-0 items-end" aria-label="측정 조회 단위">{(["day", "week", "month"] as const).map((unit, index) => <button key={unit} type="button" aria-pressed={measurementRangeUnit === unit} onClick={() => changeMeasurementRangeUnit(unit)} className={`h-9 w-9 border border-surface-300 text-xs font-medium focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${index === 0 ? "rounded-l-md" : index === 2 ? "rounded-r-md" : "-ml-px"} ${measurementRangeUnit === unit ? "bg-slate-200 text-slate-900" : "bg-white text-slate-600 hover:bg-slate-100"}`}>{unit === "day" ? "일" : unit === "week" ? "주" : "월"}</button>)}</div>
            <div className="flex shrink-0 items-end gap-1" aria-label="측정 기준일 이동">
              <Button aria-label={`이전 ${navigationUnitLabel}`} title={`이전 ${navigationUnitLabel}`} variant="secondary" className="!h-9 !w-9 !rounded-md !bg-slate-100 p-0 text-slate-700 shadow-none hover:!bg-slate-200" onClick={() => moveMeasurementRange(-1)}>◀</Button>
              <Button aria-label={`다음 ${navigationUnitLabel}`} title={`다음 ${navigationUnitLabel}`} variant="secondary" className="!h-9 !w-9 !rounded-md !bg-slate-100 p-0 text-slate-700 shadow-none hover:!bg-slate-200" onClick={() => moveMeasurementRange(1)}>▶</Button>
            </div>
            <label className="w-[360px] max-w-[420px] shrink text-xs font-medium text-text-700">코드 · 사업장명<input aria-label="코드 또는 사업장명 검색" type="text" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onKeyDown={commitSearchOnEnter} onBlur={commitSearch} placeholder="부분/정확, 쉼표 구분" className={filterControlClass} /></label>
            <div className="flex shrink-0 items-end"><Button className="h-9 px-3 text-xs" onClick={commitSearch}>검색</Button></div>
          </div> : <div className="flex flex-wrap items-end gap-2 xl:flex-nowrap">
            <label className="w-[64px] shrink-0 text-xs font-medium text-text-700">연도<input aria-label="연도" type="number" value={year} onChange={(event) => changeScope(setYear, Number(event.target.value))} className={filterControlClass} /></label>
            <label className="w-[72px] shrink-0 text-xs font-medium text-text-700">반기<select aria-label="반기" value={period} onChange={(event) => changeScope(setPeriod, event.target.value)} className={filterControlClass}><option value="">전체</option><option value="상반기">상반기</option><option value="하반기">하반기</option></select></label>
            <label className="w-[120px] shrink-0 text-xs font-medium text-text-700">예비조사일<input aria-label="예비조사일" type="date" value={preliminaryDateFilter} onChange={(event) => changeScope(setPreliminaryDateFilter, event.target.value)} className={filterControlClass} /></label>
            <label className="w-[88px] shrink-0 text-xs font-medium text-text-700">상태<select aria-label="상태 필터" value={statusFilter} onChange={(event) => changeScope(setStatusFilter, event.target.value)} className={filterControlClass}><option value="">전체</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="w-[88px] shrink-0 text-xs font-medium text-text-700">구분<select aria-label="구분 필터" value={kindFilter} onChange={(event) => changeScope(setKindFilter, event.target.value)} className={filterControlClass}><option value="">전체</option><option>최초실시</option><option>타기관 신규</option><option>기존업체</option></select></label>
            <label className="w-[68px] shrink-0 text-xs font-medium text-text-700">방식<select aria-label="방식 필터" value={methodFilter} onChange={(event) => changeScope(setMethodFilter, event.target.value)} className={filterControlClass}><option value="">전체</option><option value="field">방문</option><option value="phone">유선</option></select></label>
            <label className="w-[120px] shrink-0 text-xs font-medium text-text-700">측정 기준일<input aria-label="측정 기준일" type="date" value={measurementBaseDate} onChange={(event) => updateMeasurementBaseDate(event.target.value)} className={filterControlClass} /></label>
            <div className="flex shrink-0 items-end" aria-label="측정 조회 단위">{(["day", "week", "month"] as const).map((unit, index) => <button key={unit} type="button" aria-pressed={measurementRangeUnit === unit} onClick={() => changeMeasurementRangeUnit(unit)} className={`h-9 w-8 border border-surface-300 text-xs font-medium focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${index === 0 ? "rounded-l-md" : index === 2 ? "rounded-r-md" : "-ml-px"} ${measurementRangeUnit === unit ? "bg-slate-200 text-slate-900" : "bg-white text-slate-600 hover:bg-slate-100"}`}>{unit === "day" ? "일" : unit === "week" ? "주" : "월"}</button>)}</div>
            <div className="flex shrink-0 items-end gap-1" aria-label="측정 기준일 이동">
              <Button aria-label={`이전 ${navigationUnitLabel}`} title={`이전 ${navigationUnitLabel}`} variant="secondary" className="!h-9 !w-8 !rounded-md !bg-slate-100 p-0 text-slate-700 shadow-none hover:!bg-slate-200" onClick={() => moveMeasurementRange(-1)}>◀</Button>
              <Button aria-label={`다음 ${navigationUnitLabel}`} title={`다음 ${navigationUnitLabel}`} variant="secondary" className="!h-9 !w-8 !rounded-md !bg-slate-100 p-0 text-slate-700 shadow-none hover:!bg-slate-200" onClick={() => moveMeasurementRange(1)}>▶</Button>
            </div>
            <label className="w-[280px] max-w-[300px] shrink text-xs font-medium text-text-700">코드 · 사업장명<input aria-label="코드 또는 사업장명 검색" type="text" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onKeyDown={commitSearchOnEnter} onBlur={commitSearch} placeholder="부분/정확, 쉼표 구분" className={filterControlClass} /></label>
            <div className="flex shrink-0 items-end"><Button className="h-9 px-3 text-xs" onClick={commitSearch}>검색</Button></div>
          </div>}
          <div className="mt-2 flex h-9 min-w-0 items-center gap-2 border-t border-surface-100 pt-2 text-xs text-text-600">
            <span className="shrink-0">검색 결과 {displayRows.length}건{mode === "plan" ? " · 자동 배정은 기준일 전체 사업장 대상" : ""}</span>
            {refreshing && <span className="flex shrink-0 items-center gap-1 text-primary-700"><span className="h-3 w-3 animate-spin rounded-full border-2 border-surface-300 border-t-primary-600" />조회 중...</span>}
            {mode === "plan" && <>
              {isPlanSearchDirty && <span className="shrink-0 text-amber-700">검색어 변경 · 검색 필요</span>}
              <div className="min-w-0 flex-1" />
              <div className="ml-auto flex shrink-0 gap-2">
                <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setIsAutoAssignmentOpen(true)} disabled={working || isPlanSearchDirty} title={isPlanSearchDirty ? "검색을 먼저 실행해 주세요." : undefined}>예비조사 자동 배정</Button>
              </div>
            </>}
          </div>
        </div>
      </Card>
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {scopeSummary && <div className="text-xs text-text-600">{scopeSummary}</div>}
      <Card className="p-0">
        <div data-testid={mode === "plan" ? "phase-b-plan-table-scroll" : "phase-b-list-table-scroll"} className="overflow-visible">
          <table className="w-full min-w-[1080px] table-fixed text-sm">
            <thead className="sticky z-20 bg-surface-50 text-left text-text-700 shadow-sm" style={{ top: tableHeaderTop }}>
              <tr>
                <th className="w-52 px-2 py-3 font-semibold">사업장</th><th className="w-28 px-2 py-3 font-semibold">측정예정일</th>
                <th className="w-28 bg-primary-50 px-2 py-3 font-semibold text-primary-900">예비조사일</th><th className="w-40 bg-primary-50 px-2 py-3 font-semibold text-primary-900">예비조사자</th>
                {["방식", "측정자(공시료)", "측정 참여자", "보고서담당", "상태", "구분", "관리", "확인사항"].map((label) => <th key={label} className="px-2 py-3 font-semibold">{label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200">
              {displayRows.map((row) => (
                <tr key={row.targetId} onClick={() => openDetail(row)} className="cursor-pointer hover:bg-primary-50/40">
                  <td className="px-2 py-2"><div className="font-semibold text-text-900">{row.code}</div><div className="truncate text-text-700" title={row.businessName}>{row.businessName}</div></td>
                  <td className="px-2 py-2 whitespace-nowrap">{row.measurementDate || "-"}</td>
                  <td className="bg-primary-50/40 px-2 py-2 text-base font-bold text-primary-900 whitespace-nowrap">{row.preliminaryDate || "-"}</td>
                  <td className="truncate bg-primary-50/40 px-2 py-2 text-base font-bold text-primary-900" title={displaySurveyors(row.surveyors)}>{displaySurveyors(row.surveyors)}</td>
                  <td className="px-2 py-2">{row.surveyMethod === "field" ? "방문" : "유선"}</td>
                  <td className="truncate px-2 py-2">{row.mainMeasurer || "-"}</td>
                  <td className="truncate px-2 py-2" title={row.measurementParticipants || ""}>{row.measurementParticipants || "-"}</td>
                  <td className="truncate px-2 py-2">{row.reportWriter || "-"}</td>
                  <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLES[row.status]}`}>{STATUS_LABELS[row.status]}</span></td>
                  <td className="px-2 py-2 whitespace-nowrap">{row.kind}</td>
                  <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={working || !row.hasPersistedPlan || Boolean(row.locked) || Boolean(row.deleteProtectionReason)}
                      title={!row.hasPersistedPlan
                        ? "저장된 예비조사 계획이 없습니다."
                        : row.locked ? "확정 계획은 삭제할 수 없습니다."
                          : row.deleteProtectionReason ? "역사 복원 보호 계획입니다."
                            : "예비조사 계획 삭제"}
                      onClick={() => deletePlan(row)}
                    >삭제</Button>
                  </td>
                  <td className="px-2 py-2 text-amber-700" title={(row.conflicts ?? []).join("\n") || row.conflict || ""}>{row.conflicts?.length
                    ? row.conflicts.map((warning) => <div key={warning}>{warning}</div>)
                    : row.conflict || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayRows.length === 0 && <div className="p-10 text-center text-text-500">조건에 맞는 예비조사 대상이 없습니다.</div>}
        </div>
      </Card>

      {selected && <Modal isOpen onClose={() => setSelected(null)} title="예비조사 상세" size="lg">
        <div className="space-y-4">
          <div className="break-words text-sm text-text-700">업체명 : <strong className="text-text-900">{selected.businessName}</strong></div>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-50 p-3 text-sm">
            <div>상태: <strong>{STATUS_LABELS[selected.status]}</strong></div><div>구분: <strong>{selected.kind}</strong></div>
            <div>측정예정일: <strong>{selected.measurementDate || "-"}</strong></div><div>충돌: <strong>{selected.conflicts?.join(" · ") || selected.conflict || "없음"}</strong></div>
          </div>
          {selected.reason && <Alert variant="warning">{selected.reason}</Alert>}
          {selected.recommendationReasons && selected.recommendationReasons.length > 0 && <div className="flex flex-wrap gap-2">{selected.recommendationReasons.map((reason) => <span key={reason} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">{reason}</span>)}</div>}
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-surface-200 p-3 text-sm">
            <div>측정자(공시료): <strong>{selected.mainMeasurer || "-"}</strong></div>
            <div>측정 참여자: <strong>{selected.measurementParticipants || "-"}</strong></div>
            <div>보고서 담당자: <strong>{selected.reportWriter || "-"}</strong></div>
          </div>
          {selected.alternatives && selected.alternatives.length > 0 && <div className="rounded-lg border border-surface-200 p-3 text-sm"><strong>대안 후보일</strong><div className="mt-1">{selected.alternatives.join(" · ")}</div></div>}
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-surface-200 p-3 text-sm md:grid-cols-3">
            <div>예비조사일: <strong>{selected.preliminaryDate || "-"}</strong></div>
            <div>예비조사자: <strong>{displaySurveyors(selected.surveyors)}</strong></div>
            <div>방식: <strong>{selected.surveyMethod === "field" ? "방문" : "유선"}</strong></div>
          </div>
          {selected.locked && <Alert variant="warning">유효한 측정일지가 있어 확정된 업체입니다. 일반 자동 변경이 차단됩니다.</Alert>}
          <div className="flex justify-end"><Button variant="secondary" onClick={() => setSelected(null)}>닫기</Button></div>
        </div>
      </Modal>}
      {mode === "plan" && <FixedAssigneeReversePlanner
        isOpen={isAutoAssignmentOpen}
        initialMeasurementDate={measurementBaseDate}
        onClose={() => setIsAutoAssignmentOpen(false)}
        onApplied={async () => {
          await loadRows();
          setNotice("예비조사 배정 결과를 목록에 반영했습니다.");
        }}
      />}
    </div>
  );
}
