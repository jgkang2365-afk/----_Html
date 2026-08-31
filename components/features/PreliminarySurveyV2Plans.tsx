"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import {
  adjacentMeasurementReferenceDate,
  currentDateInKst,
  measurementRangeFromReference,
  type MeasurementRangeUnit,
} from "@/lib/preliminary-survey-v2/recommendation-range";
import {
  collectWorkbenchRecommendationTargetIds,
  matchesAnyMeasurementDateRange,
  matchesMeasurementDateRange,
  matchesWorkbenchSearch,
} from "@/lib/preliminary-survey-v2/workbench-search";
import type {
  CanonicalMeasurementAssignmentDraft,
  RecommendationScopeSnapshot,
} from "@/lib/preliminary-survey-v2/draft-canonical";
import {
  AUGUST_2026_CLEAN_ROOM_MODE,
  includesAugust2026MeasurementDate,
} from "@/lib/preliminary-survey-v2/transition-mode";

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
  measurementDates?: string[];
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
  measurementAssignmentApprovalAudit?: string | null;
  canonicalFingerprint?: string;
  recommendationScope?: RecommendationScopeSnapshot;
  measurementAssignments?: CanonicalMeasurementAssignmentDraft[];
  recommendationReasons?: string[];
  transitionMode?: typeof AUGUST_2026_CLEAN_ROOM_MODE;
  status: WorkbenchStatus;
  conflict: string | null;
  conflicts?: string[];
  reason?: string;
  alternatives?: string[];
  hasPersistedPlan?: boolean;
  locked?: boolean;
  policyDateRepairRequired?: boolean;
  policyMethodRepairRequired?: boolean;
  policyDateIssues?: string[];
  deleteProtectionReason?: "history" | null;
}

interface SurveyUser {
  id: number;
  name: string;
  is_active: boolean;
  is_preliminary_survey_experienced: boolean;
}

interface MeasurementSourceRepairSnapshot {
  measurementDate: string;
  participantUserIds: number[];
  reportWriterUserId: number | null;
  referenceParticipants?: string[] | null;
  referenceReportWriter?: string | null;
  referenceStatus?: "matched" | "mismatch" | "manual_review";
}

interface ThirdAssignmentReviewGroup {
  measurementDate: string;
  assigneeUserId: number;
  assigneeName: string;
  sameAddress: boolean;
  routeEvidenceAvailable: boolean;
  targets: Array<{ targetId: number; code: string; businessName: string; address: string | null; surveyCode: string; previousSurveyCode?: string | null }>;
}

interface ManualThirdAssignmentReview {
  fingerprint: string;
  measurementDate: string;
  assigneeUserId: number;
  assigneeName: string;
  items: Array<{ targetId: number; businessName: string; address: string; previousSurveyCode: string | null; resultSurveyCode: string }>;
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
  true_confirmed: "찐확정",
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
  const [draftTransitionMode, setDraftTransitionMode] = useState<typeof AUGUST_2026_CLEAN_ROOM_MODE | null>(null);
  const [confirmedRepairDrafts, setConfirmedRepairDrafts] = useState<ConfirmedRepairDraft[]>([]);
  const [users, setUsers] = useState<SurveyUser[]>([]);
  const [selected, setSelected] = useState<WorkbenchRow | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editMethod, setEditMethod] = useState<"field" | "phone">("field");
  const [editParticipants, setEditParticipants] = useState<number[]>([]);
  const [canApproveThirdAssignment, setCanApproveThirdAssignment] = useState(false);
  const [canManageMeasurementAssignments, setCanManageMeasurementAssignments] = useState(false);
  const [requestThirdAssignmentException, setRequestThirdAssignmentException] = useState(false);
  const [thirdAssignmentReview, setThirdAssignmentReview] = useState<ThirdAssignmentReviewGroup[]>([]);
  const [thirdAssignmentConfirmed, setThirdAssignmentConfirmed] = useState(false);
  const [measurementSourceRepairOpen, setMeasurementSourceRepairOpen] = useState(false);
  const [measurementSourceRepairSnapshots, setMeasurementSourceRepairSnapshots] = useState<MeasurementSourceRepairSnapshot[]>([]);
  const [repairMeasurementDate, setRepairMeasurementDate] = useState("");
  const [repairParticipants, setRepairParticipants] = useState(false);
  const [repairParticipantUserIds, setRepairParticipantUserIds] = useState<number[]>([]);
  const [repairReportWriter, setRepairReportWriter] = useState(false);
  const [repairReportWriterUserId, setRepairReportWriterUserId] = useState<number | null>(null);
  const [repairReason, setRepairReason] = useState("");
  const [editAssignmentDate, setEditAssignmentDate] = useState("");
  const [editAssignmentUserId, setEditAssignmentUserId] = useState<number | null>(null);
  const [editAssignmentReason, setEditAssignmentReason] = useState("");
  const [filtersReady, setFiltersReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      setCanApproveThirdAssignment(result.canApproveThirdAssignment === true);
      setCanManageMeasurementAssignments(result.canManageMeasurementAssignments === true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예비조사 통합 현황 조회 실패");
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [queryPeriod, queryYear]);

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

  const filteredRows = useMemo(() => {
    const mergedRows = rows.map((row) => drafts.get(row.targetId) ?? row);
    if (draftTransitionMode === AUGUST_2026_CLEAN_ROOM_MODE) {
      return mergedRows.filter((row) => includesAugust2026MeasurementDate(
        row.measurementDates?.length ? row.measurementDates : [row.measurementDate ?? ""],
      ));
    }
    return mergedRows.filter((row) =>
      (!activeStatusFilter || row.status === activeStatusFilter) &&
      (!activeKindFilter || row.kind === activeKindFilter) &&
      (!activePreliminaryDateFilter || row.preliminaryDate === activePreliminaryDateFilter) &&
      (matchesMeasurementDateRange(row.measurementDate, activeMeasurementDateFrom, activeMeasurementDateTo) ||
        matchesAnyMeasurementDateRange(row.measurementDates ?? [], activeMeasurementDateFrom, activeMeasurementDateTo)) &&
      (!activeMethodFilter || row.surveyMethod === activeMethodFilter),
    );
  }, [activeKindFilter, activeMeasurementDateFrom, activeMeasurementDateTo, activeMethodFilter, activePreliminaryDateFilter, activeStatusFilter, draftTransitionMode, drafts, rows]);

  const displayRows = useMemo(
    () => filteredRows.filter((row) => matchesWorkbenchSearch(row, activeSearchQuery)),
    [activeSearchQuery, filteredRows],
  );

  const measurementAssigneeForList = useCallback((row: WorkbenchRow) => {
    const assignments = row.measurementAssignments ?? [];
    if (!assignments.length) return row.mainMeasurer || "-";
    if (activeMeasurementDateFrom === activeMeasurementDateTo) {
      const assignment = assignments.find((item) => item.measurementDate === activeMeasurementDateFrom);
      return assignment ? `${assignment.userName}(${assignment.surveyCode})` : "-";
    }
    const scoped = assignments.filter((item) =>
      item.measurementDate >= activeMeasurementDateFrom && item.measurementDate <= activeMeasurementDateTo);
    if (scoped.length === 1) return `${scoped[0].userName}(${scoped[0].surveyCode})`;
    return scoped.length > 1 ? `날짜별 ${scoped.length}건 · 상세 확인` : "-";
  }, [activeMeasurementDateFrom, activeMeasurementDateTo]);

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

  const clearDraftState = () => {
    setDrafts(new Map());
    setDraftTransitionMode(null);
    setThirdAssignmentReview([]);
    setThirdAssignmentConfirmed(false);
    setConfirmedRepairDrafts([]);
    setDraftScope(null);
    setScopeSummary(null);
  };

  const invalidateDrafts = (message = "추천 범위가 변경되어 새 추천이 필요합니다.") => {
    if (!drafts.size && !confirmedRepairDrafts.length) return;
    clearDraftState();
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
    if (mode === "plan") setPlanSearchSnapshot((current) => ({ ...current, searchQuery: searchDraft }));
    else setListSearchSnapshot((current) => ({ ...current, searchQuery: searchDraft }));
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

  const selectedRows = useMemo(() => rows.filter((row) => selectedTargetIds.has(row.targetId)), [rows, selectedTargetIds]);
  const applicableDraftCount = useMemo(
    () => [...drafts.values()].filter((draft) => draft.status === "recommended").length,
    [drafts],
  );

  const requestRecommendation = async (targetId?: number, cleanRoom = false) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      if (!targetId && isPlanSearchDirty) throw new Error("검색 조건이 변경되었습니다. 먼저 검색을 실행해 주세요.");
      const cleanRoomRows = rows.filter((row) => includesAugust2026MeasurementDate(
        row.measurementDates?.length ? row.measurementDates : [row.measurementDate ?? ""],
      ));
      const recommendationTargetIds = cleanRoom
        ? cleanRoomRows.map((row) => row.targetId)
        : targetId
        ? [targetId]
        : collectWorkbenchRecommendationTargetIds(displayRows, selectedTargetIds);
      if (recommendationTargetIds.length === 0) throw new Error("현재 필터와 선택 조건에 맞는 추천 대상이 없습니다.");
      const response = await fetch("/api/preliminary-survey-v2/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "recommend", year: queryYear, period: queryPeriod,
          targetIds: recommendationTargetIds,
          explicitTargetSelection: !cleanRoom && (Boolean(targetId) || selectedTargetIds.size > 0),
          measurementDateFrom: cleanRoom ? "2026-08-01" : planSearchSnapshot.measurementDateFrom || undefined,
          measurementDateTo: cleanRoom ? "2026-08-31" : planSearchSnapshot.measurementDateTo || undefined,
          transitionMode: cleanRoom ? AUGUST_2026_CLEAN_ROOM_MODE : undefined,
          allowAdminThirdAssignment: requestThirdAssignmentException,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "추천 생성 실패");
      const generatedDrafts = result.drafts || [];
      setThirdAssignmentReview((result.thirdAssignmentReview || []) as ThirdAssignmentReviewGroup[]);
      setThirdAssignmentConfirmed(false);
      setDraftTransitionMode(cleanRoom ? AUGUST_2026_CLEAN_ROOM_MODE : null);
      const recommendedCount = generatedDrafts.filter((draft: WorkbenchRow) => draft.status === "recommended").length;
      const unavailableCount = generatedDrafts.length - recommendedCount + (result.missing || []).length;
      const repairResponse = cleanRoom ? null : await fetch("/api/preliminary-survey-v2/confirmed-document-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", targetIds: recommendationTargetIds }),
      });
      const repairResult = repairResponse ? await repairResponse.json() : { drafts: [], manualReviewCount: 0, unchangedCount: 0 };
      if (repairResponse && !repairResponse.ok) throw new Error(repairResult.error || "찐확정 누락정보 보정안 생성 실패");
      const repairDrafts = (repairResult.drafts || []) as ConfirmedRepairDraft[];
      const repairableDrafts = repairDrafts.filter((draft) => draft.classification === "MISSING_DOCUMENTARY_INFO");
      setConfirmedRepairDrafts(repairableDrafts);
      const dateScopeLabel = cleanRoom ? "2026-08-01 ~ 2026-08-31" : `${planSearchSnapshot.measurementDateFrom} ~ ${planSearchSnapshot.measurementDateTo}`;
      setDrafts((current) => {
        const next = new Map(current);
        for (const draft of generatedDrafts) next.set(draft.targetId, { ...rows.find((row) => row.targetId === draft.targetId), ...draft });
        for (const repair of repairDrafts) {
          const base = rows.find((row) => row.targetId === repair.targetId);
          if (!base) continue;
          const warning = repair.classification === "MISSING_DOCUMENTARY_INFO"
            ? "찐확정 누락정보 보정안 · 별도 확인 필요" : repair.reason;
          const conflicts = [...new Set([...(base.conflicts ?? (base.conflict ? [base.conflict] : [])), warning])];
          next.set(repair.targetId, {
            ...base,
            preliminaryDate: repair.recommendedDate ?? base.preliminaryDate,
            surveyors: repair.participantNames.length ? repair.participantNames : base.surveyors,
            surveyMethod: repair.surveyMethod ?? base.surveyMethod,
            status: repair.classification === "MISSING_DOCUMENTARY_INFO" ? "confirmed_repair" : "review_required",
            conflict: conflicts.join(" · "), conflicts,
          });
        }
        return next;
      });
      setDraftScope(cleanRoom ? AUGUST_2026_CLEAN_ROOM_MODE : currentScope);
      const manualReviewCount = Number(repairResult.manualReviewCount || 0) + unavailableCount;
      setScopeSummary(`측정예정일 범위: ${dateScopeLabel} · 대상 ${recommendationTargetIds.length}개 · 일반 추천 ${recommendedCount}건 · 찐확정 누락 보정안 ${repairableDrafts.length}건 · 변경 없음 ${Number(repairResult.unchangedCount || 0)}건 · 수동 확인 필요 ${manualReviewCount}건`);
      setNotice(cleanRoom
        ? `8월 전체 ${generatedDrafts.length}건을 기존 V2·찐확정·reconciliation 선점 없이 다시 계산했습니다. 검수 전용이며 저장되지 않습니다.`
        : targetId
        ? `${result.impactSummary || "영향 범위를 재검증했습니다."} 일반 추천과 찐확정 누락 보정안을 구분해 검토해 주세요.`
        : `일반 추천 ${recommendedCount}건 · 찐확정 누락정보 보정 ${repairableDrafts.length}건 · 변경 없음 ${Number(repairResult.unchangedCount || 0)}건 · 수동 확인 필요 ${manualReviewCount}건입니다. 아직 저장되지 않았습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추천 생성 실패");
    } finally {
      setWorking(false);
    }
  };

  const applyDrafts = async () => {
    if (draftTransitionMode === AUGUST_2026_CLEAN_ROOM_MODE) {
      setError("8월 clean-room 결과는 검수 전용이며 적용할 수 없습니다.");
      return;
    }
    if (draftScope !== currentScope) {
      setError("추천 범위가 변경되었습니다. 새 추천안을 생성해 주세요.");
      return;
    }
    const targetIds = [...drafts.keys()].filter((id) => drafts.get(id)?.status === "recommended");
    if (!targetIds.length) return;
    if (thirdAssignmentReview.length > 0 && !thirdAssignmentConfirmed) {
      setError("관리자 CCC 예외 검토 내용을 확인한 뒤 적용할 수 있습니다.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const send = (approveThirdAssignment: boolean) => fetch("/api/preliminary-survey-v2/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          drafts: targetIds.map((id) => drafts.get(id)),
          allowAdminThirdAssignment: requestThirdAssignmentException,
          approveThirdAssignment,
        }),
      });
      let response = await send(thirdAssignmentConfirmed);
      let result = await response.json();
      if (response.status === 409 && result.approvalRequired && thirdAssignmentConfirmed && window.confirm(`${result.error}\n승인하여 적용하시겠습니까?`)) {
        response = await send(true);
        result = await response.json();
      }
      if (!response.ok) throw new Error(result.error || "추천안 적용 실패");
      clearDraftState();
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
    setMeasurementSourceRepairOpen(false);
    setMeasurementSourceRepairSnapshots([]);
    setRepairMeasurementDate("");
    setRepairParticipants(false);
    setRepairParticipantUserIds([]);
    setRepairReportWriter(false);
    setRepairReportWriterUserId(null);
    setRepairReason("");
    const firstAssignment = row.measurementAssignments?.[0] ?? null;
    setEditAssignmentDate(firstAssignment?.measurementDate ?? "");
    setEditAssignmentUserId(firstAssignment?.userId ?? null);
    setEditAssignmentReason("");
  };

  const saveManual = async () => {
    if (!selected || (selected.locked && !canApproveThirdAssignment)) return;
    setWorking(true);
    setError(null);
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
      clearDraftState();
      setSelected(null);
      const warningSuffix = Array.isArray(result.policyWarnings) && result.policyWarnings.length
        ? ` · 지침 경고 ${result.policyWarnings.length}건 확인 후 관리자 저장`
        : "";
      setNotice(`수동 수정 내용을 저장했습니다${warningSuffix}.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수동 저장 실패");
    } finally {
      setWorking(false);
    }
  };

  const applyConfirmedRepairs = async () => {
    if (!confirmedRepairDrafts.length || draftScope !== currentScope) return;
    if (!window.confirm(`찐확정 계획 ${confirmedRepairDrafts.length}건의 누락된 예비조사 정보만 보정하시겠습니까?\n기존 값과 측정 원천은 변경되지 않습니다.`)) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/confirmed-document-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", targetIds: confirmedRepairDrafts.map((draft) => draft.targetId), drafts: confirmedRepairDrafts }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "찐확정 누락정보 보정 실패");
      clearDraftState();
      setNotice(`찐확정 누락정보 ${result.repairedCount}건을 보정했습니다.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "찐확정 누락정보 보정 실패");
    } finally {
      setWorking(false);
    }
  };

  const repairConfirmedPolicyDate = async () => {
    if (!selected?.locked || !selected.policyDateRepairRequired) return;
    setWorking(true);
    setError(null);
    try {
      const previewResponse = await fetch("/api/preliminary-survey-v2/policy-repair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", targetId: selected.targetId }),
      });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.error || "정책 repair 검토 실패");
      const candidateDates = Array.isArray(preview.candidateDates) ? preview.candidateDates as string[] : [];
      const recommendedDate = window.prompt(
        `현재 예비조사일: ${preview.currentRecommendedDate || "-"}\n정책 후보: ${candidateDates.join(", ")}`,
        candidateDates[0] || "",
      );
      if (recommendedDate == null) return;
      const reason = window.prompt("정책 repair 사유를 입력해 주세요.", "예비조사일 운영지침 불일치 보정");
      if (reason == null) return;
      const applyResponse = await fetch("/api/preliminary-survey-v2/policy-repair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", targetId: selected.targetId, recommendedDate, reason }),
      });
      const applied = await applyResponse.json();
      if (!applyResponse.ok) throw new Error(applied.error || "정책 repair 저장 실패");
      clearDraftState();
      setSelected(null);
      setNotice("찐확정 예비조사일 정책 repair를 기록했습니다. 측정일지와 다른 역할 원천은 변경하지 않았습니다.");
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정책 repair 저장 실패");
    } finally {
      setWorking(false);
    }
  };

  const repairConfirmedPolicyMethod = async () => {
    if (!selected?.locked || !selected.policyMethodRepairRequired) return;
    const reason = window.prompt("최초실시/타기관 신규 계획을 방문 방식으로 최소 보정할 사유를 입력해 주세요.", "방문 필수 운영지침 불일치 보정");
    if (reason == null || !reason.trim()) return;
    if (!window.confirm(`${selected.businessName}의 찐확정 예비조사 방식만 방문으로 보정하시겠습니까?\n측정일지·날짜·예비조사자·공시료는 변경하지 않습니다.`)) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/policy-repair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply_method", targetId: selected.targetId, reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "방식 repair 저장 실패");
      clearDraftState();
      setSelected(null);
      setNotice("찐확정 예비조사 방식을 방문으로 최소 보정하고 감사기록을 남겼습니다.");
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "방식 repair 저장 실패");
    } finally {
      setWorking(false);
    }
  };

  const selectedMeasurementSource = measurementSourceRepairSnapshots
    .find((item) => item.measurementDate === repairMeasurementDate) ?? null;
  const selectedMeasurementAssignment = selected?.measurementAssignments
    ?.find((assignment) => assignment.measurementDate === editAssignmentDate) ?? null;

  const saveMeasurementAssignment = async () => {
    if (!selected || (selected.locked && !canApproveThirdAssignment) || !selectedMeasurementAssignment?.assignmentId || editAssignmentUserId == null || !editAssignmentReason.trim()) return;
    const nextUser = users.find((user) => user.id === editAssignmentUserId);
    if (!nextUser) return;
    if (!window.confirm(
      `${selected.businessName} ${selectedMeasurementAssignment.measurementDate} 공시료 담당자를 ` +
      `${selectedMeasurementAssignment.userName}에서 ${nextUser.name}(으)로 변경하시겠습니까?\n` +
      "같은 측정일의 영향 그룹 코드는 C/CC/CCC/CCCC… 규칙으로 함께 재정규화됩니다.",
    )) return;
    setWorking(true);
    setError(null);
    try {
      const send = (
        confirm: boolean,
        approveThirdAssignment = false,
        expectedApprovalGroupFingerprint: string | null = null,
      ) => fetch("/api/preliminary-survey-v2/measurement-assignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: selected.targetId,
          assignmentId: selectedMeasurementAssignment.assignmentId,
          expectedMeasurementDate: selectedMeasurementAssignment.measurementDate,
          expectedAssigneeUserId: selectedMeasurementAssignment.userId,
          assigneeUserId: editAssignmentUserId,
          reason: editAssignmentReason.trim(),
          confirm,
          approveThirdAssignment,
          expectedApprovalGroupFingerprint,
        }),
      });
      let response = await send(false);
      let result = await response.json();
      if (response.ok && result.requiresUserConfirmation && window.confirm(result.message)) {
        response = await send(true);
        result = await response.json();
      }
      if (!response.ok && result.approvalRequired === true && canApproveThirdAssignment) {
        const review = result.approvalReview as ManualThirdAssignmentReview | null;
        if (!review?.fingerprint || review.items.length !== 3) throw new Error("CCC 승인 그룹이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
        const groupSummary = review.items.map((item) =>
          `${item.businessName} → ${review.assigneeName}(${item.resultSurveyCode})\n  ${item.address}`,
        ).join("\n");
        if (window.confirm(
          `${review.measurementDate} ${review.assigneeName} 3건 예외 배정입니다.\n\n${groupSummary}\n\n` +
          "위 3개 업체와 결과 코드를 확인했습니다. 관리자 CCC 예외로 저장하시겠습니까?",
        )) {
          response = await send(true, true, review.fingerprint);
          result = await response.json();
        }
      }
      if (!response.ok || !result.success) throw new Error(result.error || "공시료 수정 실패");
      clearDraftState();
      setSelected(null);
      const warningSuffix = Array.isArray(result.policyWarnings) && result.policyWarnings.length
        ? ` · 지침 경고 ${result.policyWarnings.length}건 확인 후 관리자 저장`
        : "";
      setNotice(`날짜별 공시료 담당자를 수정하고 영향 그룹 코드를 재정규화했습니다${warningSuffix}.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "공시료 수정 실패");
    } finally {
      setWorking(false);
    }
  };

  const openMeasurementSourceRepair = async () => {
    if (!selected) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(`/api/preliminary-survey-v2/measurement-source-repair?targetId=${selected.targetId}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "측정 원천 조회 실패");
      const snapshots = Array.isArray(result.sources) ? result.sources as MeasurementSourceRepairSnapshot[] : [];
      if (!snapshots.length) throw new Error("측정 원천 날짜가 없습니다.");
      const first = snapshots[0];
      setMeasurementSourceRepairSnapshots(snapshots);
      setRepairMeasurementDate(first.measurementDate);
      setRepairParticipantUserIds(first.participantUserIds);
      setRepairReportWriterUserId(first.reportWriterUserId);
      setMeasurementSourceRepairOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "측정 원천 조회 실패");
    } finally {
      setWorking(false);
    }
  };

  const changeRepairMeasurementDate = (measurementDate: string) => {
    const snapshot = measurementSourceRepairSnapshots.find((item) => item.measurementDate === measurementDate);
    setRepairMeasurementDate(measurementDate);
    setRepairParticipantUserIds(snapshot?.participantUserIds ?? []);
    setRepairReportWriterUserId(snapshot?.reportWriterUserId ?? null);
  };

  const saveMeasurementSourceRepair = async () => {
    if (!selected || !repairMeasurementDate || (!repairParticipants && !repairReportWriter)) return;
    if (!repairReason.trim()) {
      setError("측정 원천 repair 사유를 입력해 주세요.");
      return;
    }
    const fields = [repairParticipants ? "측정 참여자" : null, repairReportWriter ? "보고서 담당자" : null]
      .filter((field): field is string => Boolean(field));
    if (!window.confirm(`${selected.businessName} ${repairMeasurementDate}의 ${fields.join("·")}만 보정하시겠습니까?\n예비조사자와 측정자(공시료), 측정일지는 변경하지 않습니다.`)) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/measurement-source-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: selected.targetId,
          measurementDate: repairMeasurementDate,
          repairParticipants,
          participantUserIds: repairParticipantUserIds,
          repairReportWriter,
          reportWriterUserId: repairReportWriterUserId,
          reason: repairReason.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "측정 원천 repair 저장 실패");
      clearDraftState();
      setMeasurementSourceRepairOpen(false);
      setSelected(null);
      setNotice(`${(result.repairedFields || []).join("·")} 원천만 보정하고 감사기록을 남겼습니다.`);
      await loadRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "측정 원천 repair 저장 실패");
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
      clearDraftState();
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
            <span className="shrink-0">검색 결과 {displayRows.length}건{mode === "plan" ? ` · 선택 ${selectedTargetIds.size}건` : ""}</span>
            {refreshing && <span className="flex shrink-0 items-center gap-1 text-primary-700"><span className="h-3 w-3 animate-spin rounded-full border-2 border-surface-300 border-t-primary-600" />조회 중...</span>}
            {mode === "plan" && <>
              {isPlanSearchDirty && <span className="shrink-0 text-amber-700">검색어 변경 · 검색 필요</span>}
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{selectedRows.slice(0, 4).map((row) => <span key={row.targetId} className="flex max-w-36 items-center gap-1 rounded-full bg-surface-100 px-2 py-1"><span className="truncate">{row.code} {row.businessName}</span><button aria-label={`${row.businessName} 선택 해제`} onClick={() => toggleTarget(row.targetId)}>×</button></span>)}{selectedTargetIds.size > 4 && <span>외 {selectedTargetIds.size - 4}건</span>}{selectedTargetIds.size > 0 && <button className="ml-1 shrink-0 text-primary-700 underline" onClick={() => { invalidateDrafts(); setSelectedTargetIds(new Set()); }}>전체 해제</button>}</div>
              <div className="ml-auto flex shrink-0 gap-2">
                {canApproveThirdAssignment && <label className="flex h-9 items-center gap-1 whitespace-nowrap text-xs text-amber-800">
                  <input type="checkbox" checked={requestThirdAssignmentException} onChange={(event) => {
                    invalidateDrafts("관리자 3건 예외 검토 조건이 변경되어 새 추천이 필요합니다.");
                    setRequestThirdAssignmentException(event.target.checked);
                  }} />
                  관리자 CCC 예외 검토
                </label>}
                <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => requestRecommendation()} disabled={working || isPlanSearchDirty}>{drafts.size ? "새로 추천" : "추천 생성"}</Button>
                {queryYear === 2026 && <Button size="sm" className="shrink-0 whitespace-nowrap" variant="secondary" onClick={() => requestRecommendation(undefined, true)} disabled={working || isPlanSearchDirty}>8월 Clean-room</Button>}
                <Button size="sm" className="shrink-0 whitespace-nowrap" variant="secondary" onClick={() => setNotice("행을 선택하면 추천 근거와 업체별 대안을 확인할 수 있습니다.")} disabled={isPlanSearchDirty}>대안 보기</Button>
                <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={applyDrafts} disabled={working || isPlanSearchDirty || draftTransitionMode != null || applicableDraftCount === 0 || draftScope !== currentScope}>추천안 적용</Button>
                <Button size="sm" className="shrink-0 whitespace-nowrap" variant="secondary" onClick={applyConfirmedRepairs} disabled={working || isPlanSearchDirty || draftTransitionMode != null || confirmedRepairDrafts.length === 0 || draftScope !== currentScope}>누락정보 보정</Button>
              </div>
            </>}
          </div>
        </div>
      </Card>
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {scopeSummary && <div className="text-xs text-text-600">{scopeSummary}</div>}
      {canApproveThirdAssignment && thirdAssignmentReview.length > 0 && <Card className="border-amber-300 bg-amber-50 p-3 text-sm">
        <strong>관리자 CCC 예외 확인</strong><p className="mt-1 text-xs text-text-600">아래 3개 업체의 날짜·측정자·코드와 주소/동선 근거를 확인한 뒤에만 적용합니다.</p>
        <div className="mt-2 space-y-2">{thirdAssignmentReview.map((group) => <div key={`${group.measurementDate}:${group.assigneeUserId}`} className="rounded border border-amber-200 bg-white p-2"><div className="font-medium">{group.measurementDate} · {group.assigneeName} · 동일주소 {group.sameAddress ? "예" : "아니오"} · 차량동선 근거 {group.routeEvidenceAvailable ? "있음" : "없음"}</div>{group.targets.map((target) => <div key={target.targetId} className="text-xs">{target.surveyCode} · {target.code} {target.businessName} · {target.address || "주소 미확인"}{target.previousSurveyCode && target.previousSurveyCode !== target.surveyCode ? ` · 기존 ${target.previousSurveyCode}` : ""}</div>)}</div>)}</div>
        <label className="mt-2 flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={thirdAssignmentConfirmed} onChange={(event) => setThirdAssignmentConfirmed(event.target.checked)} />위 3건 예외와 C/CC/CCC 결과를 확인했습니다.</label>
      </Card>}
      <Card className="p-0">
        <div data-testid={mode === "plan" ? "phase-b-plan-table-scroll" : "phase-b-list-table-scroll"} className="overflow-visible">
          <table className="w-full min-w-[1080px] table-fixed text-sm">
            <thead className="sticky z-20 bg-surface-50 text-left text-text-700 shadow-sm" style={{ top: tableHeaderTop }}>
              <tr>{mode === "plan" && <th className="w-9 px-2 py-3"><input aria-label="표시 대상 전체 선택" type="checkbox" checked={displayRows.length > 0 && displayRows.every((row) => selectedTargetIds.has(row.targetId))} onChange={toggleDisplayedTargets} /></th>}{["상태", "예비조사일", "코드", "사업장명", "구분", "방식", "측정예정일", "예비조사자", "측정자(공시료)", "측정 참여자", "보고서 담당", "관리", "충돌"].map((label) => <th key={label} className="px-2 py-3 font-semibold first:w-24">{label}</th>)}</tr>
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
                  <td className="px-2 py-2">{row.surveyMethod === "field" ? "방문" : "유선"}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{row.measurementDate || "-"}</td>
                  <td className="truncate px-2 py-2" title={row.surveyors.join(", ")}>{row.surveyors.join(", ") || "-"}</td>
                  <td className="truncate px-2 py-2" title={measurementAssigneeForList(row)}>{measurementAssigneeForList(row)}</td>
                  <td className="truncate px-2 py-2" title={row.measurementParticipants || ""}>{row.measurementParticipants || "-"}</td>
                  <td className="truncate px-2 py-2">{row.reportWriter || "-"}</td>
                  <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                    {row.hasPersistedPlan ? <Button
                      size="sm"
                      variant="danger"
                      disabled={working || Boolean(row.locked) || Boolean(row.deleteProtectionReason)}
                      title={row.locked ? "찐확정 계획은 삭제할 수 없습니다." : row.deleteProtectionReason ? "역사 복원 보호 계획입니다." : "예비조사 계획 삭제"}
                      onClick={() => deletePlan(row)}
                    >계획 삭제</Button> : <span className="text-xs text-text-400" title="저장된 예비조사 계획이 없습니다.">-</span>}
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

      {selected && <Modal isOpen onClose={() => setSelected(null)} title="예비조사 상세" size="lg" showCloseButton>
        <div className="space-y-4 pt-1">
          <div className="rounded-lg border border-surface-200 bg-white p-3 text-sm">
            <span className="font-medium text-text-600">업체명 : </span>
            <strong className="break-words [overflow-wrap:anywhere]">{selected.businessName}</strong>
          </div>
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
          {(selected.measurementAssignments?.length ?? 0) > 0 && <div className="rounded-lg border border-surface-200 p-3">
            <div className="mb-2"><strong className="text-sm">실제 측정일별 공시료</strong><p className="text-xs text-text-500">다일 사업장도 각 실제 측정일의 담당자와 반복코드를 독립 표시합니다.</p></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead className="bg-surface-50 text-left"><tr><th className="px-2 py-2">측정일</th><th className="px-2 py-2">담당자</th><th className="px-2 py-2">코드</th></tr></thead><tbody>{selected.measurementAssignments?.map((assignment) => <tr key={`${assignment.targetId}-${assignment.measurementDate}`} className="border-t border-surface-100"><td className="px-2 py-2">{assignment.measurementDate}</td><td className="px-2 py-2">{assignment.userName}</td><td className="px-2 py-2 font-medium">{assignment.surveyCode}</td></tr>)}</tbody></table></div>
            {canManageMeasurementAssignments && (!selected.locked || canApproveThirdAssignment) && selected.measurementAssignments?.some((assignment) => assignment.assignmentId) && <div className="mt-3 grid gap-3 border-t border-surface-100 pt-3 md:grid-cols-2">
              <label className="block text-sm font-medium text-text-700">측정일<select value={editAssignmentDate} onChange={(event) => {
                const assignment = selected.measurementAssignments?.find((item) => item.measurementDate === event.target.value) ?? null;
                setEditAssignmentDate(event.target.value);
                setEditAssignmentUserId(assignment?.userId ?? null);
              }} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">{selected.measurementAssignments.filter((assignment) => assignment.assignmentId).map((assignment) => <option key={assignment.measurementDate} value={assignment.measurementDate}>{assignment.measurementDate}</option>)}</select></label>
              <label className="block text-sm font-medium text-text-700">공시료 담당자<select value={editAssignmentUserId ?? ""} onChange={(event) => setEditAssignmentUserId(event.target.value ? Number(event.target.value) : null)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm"><option value="">선택</option>{users.filter((user) => user.is_active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
              <div className="md:col-span-2"><Input label="수정 사유" value={editAssignmentReason} onChange={(event) => setEditAssignmentReason(event.target.value)} placeholder="예: 8/25 실제 공시료 담당자 배정 정정" /></div>
              {canApproveThirdAssignment && <div className="md:col-span-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">관리자는 지침과 다른 공시료 배정도 경고 확인 후 저장할 수 있습니다. 동일일 영향 그룹 코드는 자동 재정규화되고 audit이 기록됩니다.</div>}
              <div className="flex justify-end md:col-span-2"><Button size="sm" onClick={saveMeasurementAssignment} disabled={working || !selectedMeasurementAssignment?.assignmentId || editAssignmentUserId == null || editAssignmentUserId === selectedMeasurementAssignment.userId || !editAssignmentReason.trim()}>공시료 수정</Button></div>
            </div>}
          </div>}
          {selected.measurementAssignmentApprovalAudit && <Alert variant="warning">공시료 관리자 예외 기록: {selected.measurementAssignmentApprovalAudit}</Alert>}
          {selected.alternatives && selected.alternatives.length > 0 && <div className="rounded-lg border border-surface-200 p-3 text-sm"><strong>대안 후보일</strong><div className="mt-1">{selected.alternatives.join(" · ")}</div></div>}
          <Input label="예비조사일" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} disabled={Boolean(selected.locked && !canApproveThirdAssignment)} />
          <label className="block text-sm font-medium text-text-700">방식
            <select value={editMethod} onChange={(event) => setEditMethod(event.target.value as "field" | "phone")} disabled={Boolean(selected.locked && !canApproveThirdAssignment)} className="mt-1 block h-10 w-full rounded-md border border-surface-300 bg-white px-3"><option value="field">방문</option><option value="phone">유선</option></select>
          </label>
          <fieldset disabled={Boolean(selected.locked && !canApproveThirdAssignment)}><legend className="mb-2 text-sm font-medium text-text-700">예비조사자</legend><div className="grid grid-cols-2 gap-2">{users.filter((user) => user.is_active).map((user) => <label key={user.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editParticipants.includes(user.id)} onChange={() => setEditParticipants((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} />{user.name}{user.is_preliminary_survey_experienced ? " (경력)" : ""}</label>)}</div></fieldset>
          <div className="rounded-lg border border-surface-200 p-3">
            <div className="flex items-center justify-between gap-2"><div><strong className="text-sm">측정 원천 repair</strong><p className="text-xs text-text-500">측정 참여자와 보고서 담당자를 독립적으로 최소 보정합니다.</p></div><Button size="sm" variant="secondary" onClick={openMeasurementSourceRepair} disabled={working}>원천 보정</Button></div>
            {measurementSourceRepairOpen && <div className="mt-3 space-y-3 border-t border-surface-100 pt-3">
              <label className="block text-sm font-medium text-text-700">측정일<select value={repairMeasurementDate} onChange={(event) => changeRepairMeasurementDate(event.target.value)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">{measurementSourceRepairSnapshots.map((snapshot) => <option key={snapshot.measurementDate} value={snapshot.measurementDate}>{snapshot.measurementDate}</option>)}</select></label>
              <label className="flex items-center gap-2 text-sm font-medium text-text-700"><input type="checkbox" checked={repairParticipants} onChange={(event) => setRepairParticipants(event.target.checked)} />측정 참여자 보정</label>
              {repairParticipants && <div className="grid grid-cols-2 gap-2">{users.filter((user) => user.is_active).map((user) => <label key={user.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={repairParticipantUserIds.includes(user.id)} onChange={() => setRepairParticipantUserIds((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} />{user.name}</label>)}</div>}
              <label className="flex items-center gap-2 text-sm font-medium text-text-700"><input type="checkbox" checked={repairReportWriter} onChange={(event) => setRepairReportWriter(event.target.checked)} />보고서 담당자 보정</label>
              {repairReportWriter && <label className="block text-sm font-medium text-text-700">보고서 담당자<select value={repairReportWriterUserId ?? ""} onChange={(event) => setRepairReportWriterUserId(event.target.value ? Number(event.target.value) : null)} className="mt-1 block h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm"><option value="">선택</option>{users.filter((user) => user.is_active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}
              <Input label="보정 사유" value={repairReason} onChange={(event) => setRepairReason(event.target.value)} placeholder="예: H0038 현재 측정 참여자 원천 정정" />
              <div className="rounded bg-surface-50 p-2 text-xs text-text-600">현재 원천: 참여자 {(selectedMeasurementSource?.participantUserIds ?? []).map((id) => users.find((user) => user.id === id)?.name || `ID ${id}`).join(", ") || "-"} · 보고서 담당자 {users.find((user) => user.id === selectedMeasurementSource?.reportWriterUserId)?.name || "-"}<br />기준(legacy actual): 참여자 {selectedMeasurementSource?.referenceParticipants?.join(", ") || "수동 확인 필요"} · 보고서 담당자 {selectedMeasurementSource?.referenceReportWriter || "수동 확인 필요"}<br />판정: {selectedMeasurementSource?.referenceStatus === "manual_review" ? "기준이 모호하여 수동 확인" : "현재/기준 비교 후 선택한 필드만 보정"}</div>
              <div className="flex justify-end"><Button size="sm" onClick={saveMeasurementSourceRepair} disabled={working || (!repairParticipants && !repairReportWriter) || !repairReason.trim()}>원천 repair 저장</Button></div>
            </div>}
          </div>
          {selected.locked && (canApproveThirdAssignment
            ? <Alert variant="warning">찐확정 업체입니다. 자동추천·삭제는 보호되지만 관리자는 수정 모달에서 직접 값을 변경할 수 있습니다. 지침 위반 입력은 저장 전 경고되며 변경 내역은 audit에 기록됩니다.</Alert>
            : <Alert variant="warning">유효한 측정일지가 있어 찐확정된 업체입니다. 일반 수정과 자동추천이 차단됩니다.</Alert>)}
          <div className="flex flex-wrap justify-end gap-2 border-t border-surface-100 pt-3">
            <Button variant="secondary" onClick={() => setSelected(null)} disabled={working}>닫기</Button>
            <Button variant="secondary" onClick={() => requestRecommendation(selected.targetId)} disabled={working || Boolean(selected.locked)}>이 업체 재추천</Button>
            {selected.policyDateRepairRequired && <Button variant="secondary" onClick={repairConfirmedPolicyDate} disabled={working || !selected.locked}>날짜 repair</Button>}
            {selected.policyMethodRepairRequired && <Button variant="secondary" onClick={repairConfirmedPolicyMethod} disabled={working || !selected.locked}>방식 repair</Button>}
            <Button onClick={saveManual} disabled={working || Boolean(selected.locked && !canApproveThirdAssignment) || !editDate || editParticipants.length === 0}>수동 저장</Button>
          </div>
        </div>
      </Modal>}
    </div>
  );
}
