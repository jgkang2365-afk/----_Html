"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatPreliminarySurveyParticipantsForDisplay } from "@/lib/preliminary-survey-v2/participant-display";
import type {
  PlannerTarget,
  PlanningSnapshot,
  ReversePlannerOutput,
  ReversePlannerReason,
  ReversePlannerResult,
} from "@/lib/preliminary-survey-v2/reverse-planner/types";

interface FixedAssigneeReversePlannerProps {
  isOpen: boolean;
  initialMeasurementDate: string;
  onClose: () => void;
  onApplied: () => void | Promise<void>;
}

interface ReviewAdjustment {
  targetId: number;
  preliminaryDate: string;
  participantUserIds: number[];
}

interface ReviewSuggestion extends ReviewAdjustment {
  surveyMethod: "field" | "phone";
  reasons: string[];
}

const dateLabel = (date: string) => date ? `${date.slice(0, 4)}년 ${date.slice(5, 7)}월 ${date.slice(8, 10)}일` : "";
const moveDate = (date: string, amount: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
};

const reasonLabel: Record<ReversePlannerReason, string> = {
  FIXED_ASSIGNEE_NOT_CONFIRMED: "측정자 확인 필요",
  ONLY_MISMATCH_ALTERNATIVES_AVAILABLE: "수동 배정 필요",
  NO_EXPERIENCED_PARTNER_AVAILABLE: "예비조사자 확인 필요",
  NO_VALID_PRELIMINARY_DATE: "예비조사일 확인 필요",
  ROUTE_EVIDENCE_REQUIRED: "이동경로 확인 필요",
  PROTECTED_PLAN_REQUIRES_REVIEW: "기존 확정값 확인",
  ADMIN_OVERRIDE_SOURCE_CHANGED: "관리자 지정 재검토 필요",
  TRANSITION_BOUNDARY_REVIEW_REQUIRED: "전환기간 자료 확인 필요",
  SOURCE_CHANGED: "원천정보가 변경되었습니다. 배정안을 다시 계산해 주세요.",
  TARGET_NOT_FOUND: "사업장 원천정보 확인 필요",
  USER_NOT_FOUND: "직원 원천정보 확인 필요",
  INVALID_MEASUREMENT_DATES: "측정일 원천정보 확인 필요",
  INVALID_DAILY_STAFF: "다일 측정정보 확인 필요",
  INVALID_BASE_CODE: "공시료 코드 확인 필요",
  CONFLICTING_AUTHORITATIVE_SOURCE: "원천정보 확인 필요",
  MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED: "측정자 이동경로 확인 필요",
  MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE: "측정자 3건째는 관리자 확인이 필요합니다.",
  MEASUREMENT_ASSIGNMENT_CAPACITY_EXCEEDED: "측정자 4건 이상은 배정할 수 없습니다.",
  MEASUREMENT_ASSIGNEE_INTERSECTION_REQUIRED: "측정자(공시료 담당자)가 예비조사자에 포함되어야 합니다.",
  SOLVER_TIMEOUT: "배정 계산 시간 초과",
  NO_FEASIBLE_BATCH_ASSIGNMENT: "일정·용량 충돌 확인 필요",
};

function resultStatus(result: ReversePlannerResult | undefined, target: PlannerTarget) {
  if (!result) return target.existingPlan
    ? { label: "기존 배정", tone: "text-slate-700 bg-slate-100" }
    : { label: "계산 전", tone: "text-slate-600 bg-slate-100" };
  if (result.decision === "AUTO_ASSIGNED") return result.mutation === "KEEP_EXISTING"
    ? { label: "기존 배정 유지", tone: "text-emerald-800 bg-emerald-50" }
    : { label: "배정 가능", tone: "text-emerald-800 bg-emerald-50" };
  if (result.decision === "ADMIN_OVERRIDE_KEPT") {
    return { label: "관리자 지정 유지", tone: "text-blue-800 bg-blue-50" };
  }
  if (result.decision === "SOURCE_INVALID") {
    return { label: "원천정보 확인 필요", tone: "text-red-800 bg-red-50" };
  }
  return { label: result.reason ? reasonLabel[result.reason] : "수동 배정 필요", tone: "text-amber-800 bg-amber-50" };
}

const violationLabels: Record<string, string> = {
  ACTUAL_MEASUREMENT_CONFLICT: "예비조사자의 실제 측정 일정이 겹칩니다.",
  ACTUAL_TEAM_INTERSECTION_REQUIRED: "예비조사자와 실제 측정팀의 일치 인원이 없습니다.",
  FIELD_ROUTE_OVER_60_MINUTES: "방문 이동시간이 60분을 초과합니다.",
  FIELD_VISIT_CAPACITY_EXCEEDED: "방문 예비조사 가능 건수를 초과합니다.",
  INVALID_SURVEYOR_ROLE_COMBINATION: "예비조사자 경력 구성이 지침과 맞지 않습니다.",
  PHONE_RESPONSIBLE_CAPACITY_EXCEEDED: "유선 조사 담당자의 하루 가능 건수를 초과합니다.",
  PRELIMINARY_DATE_OUT_OF_RANGE: "예비조사일이 허용 범위를 벗어났습니다.",
  SURVEY_METHOD_MISMATCH: "사업장 구분과 조사 방식이 맞지 않습니다.",
  USER_UNAVAILABLE_ON_SURVEY_DATE: "예비조사자 불가 일정과 겹칩니다.",
  ...reasonLabel,
  REVIEW_ADJUSTMENT_BATCH_CONFLICT: "같은 batch의 다른 배정안과 일정·용량·동선이 충돌합니다.",
  INVALID_REVIEW_ADJUSTMENT_PAYLOAD: "수정안 입력값을 확인해 주세요.",
  ADMIN_OVERRIDE_REQUIRES_ADMIN: "관리자 지정 편성은 관리자 예외 수정으로만 변경할 수 있습니다.",
};

const violationText = (value: string) => violationLabels[value] ?? "운영지침 확인이 필요합니다.";

const businessTypeLabel: Record<PlannerTarget["businessType"], string> = {
  first_measurement: "최초실시",
  external_new: "타기관 신규",
  existing: "기존",
};

const suggestionReason = (reasons: string[]) => {
  const labels = [
    reasons.includes("KEEP_EXISTING") ? "기존값 유지" : null,
    reasons.includes("PRIMARY_DATE") ? "정책 우선 후보" : null,
    reasons.includes("FALLBACK_DATE") ? "fallback 후보" : null,
    reasons.includes("EXPERIENCED_SOLO") ? "경력자 단독" : null,
    reasons.includes("EXPERIENCED_AND_INEXPERIENCED") ? "경력+비경력" : null,
  ].filter(Boolean);
  return labels.join(" · ") || "운영지침 검증 완료";
};

type RouteWarning = { label: string; detail: string };
function collapseRouteWarnings(items: RouteWarning[]) {
  const grouped = new Map<string, string[]>();
  for (const item of items) grouped.set(item.label, [...(grouped.get(item.label) ?? []), item.detail]);
  return [...grouped.entries()].map(([label, details]) => ({
    label,
    detail: [...new Set(details)].join("\n"),
  }));
}

export function FixedAssigneeReversePlanner({
  isOpen,
  initialMeasurementDate,
  onClose,
  onApplied,
}: FixedAssigneeReversePlannerProps) {
  const [measurementDate, setMeasurementDate] = useState(initialMeasurementDate);
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [preview, setPreview] = useState<ReversePlannerOutput | null>(null);
  const [repairDrafts, setRepairDrafts] = useState<Array<Record<string, unknown>>>([]);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canOverride, setCanOverride] = useState(false);
  const [overrideTargetId, setOverrideTargetId] = useState<number | null>(null);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideMethod, setOverrideMethod] = useState<"field" | "phone">("field");
  const [overrideResponsible, setOverrideResponsible] = useState<number | null>(null);
  const [overrideReviewer, setOverrideReviewer] = useState<number | null>(null);
  const [overrideParticipants, setOverrideParticipants] = useState<number[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideViolations, setOverrideViolations] = useState<string[]>([]);
  const [reviewAdjustments, setReviewAdjustments] = useState<Map<number, ReviewAdjustment>>(new Map());
  const [reviewSuggestions, setReviewSuggestions] = useState<ReviewSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const userById = useMemo(() => new Map((snapshot?.users ?? []).map((user) => [user.id, user])), [snapshot]);
  const participantText = useCallback((ids: number[]) => formatPreliminarySurveyParticipantsForDisplay(ids.map((id) => ({
    name: userById.get(id)?.name ?? "",
    experienced: userById.get(id)?.experienced,
  }))), [userById]);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "예비조사 자동 배정 요청에 실패했습니다.");
    return result;
  }, []);

  const load = useCallback(async (date: string) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    setRepairDrafts([]);
    setOverrideTargetId(null);
    try {
      const result = await request(`/api/preliminary-survey-v2/reverse-planner?measurementDate=${date}`);
      setSnapshot(result.snapshot);
      setReviewAdjustments(new Map());
      setReviewSuggestions([]);
      setSuggestionError(null);
      setCanOverride(result.canOverride === true);
    } catch (caught) {
      setSnapshot(null);
      setError(caught instanceof Error ? caught.message : "배정 대상을 불러오지 못했습니다.");
    } finally {
      setWorking(false);
    }
  }, [request]);

  useEffect(() => {
    if (!isOpen) return;
    setMeasurementDate(initialMeasurementDate);
    void load(initialMeasurementDate);
  }, [initialMeasurementDate, isOpen, load]);

  const changeMeasurementDate = (date: string) => {
    setMeasurementDate(date);
    void load(date);
  };

  const confirmFixed = async (targetId: number, fixedDate: string, assigneeUserId: number) => {
    const target = snapshot?.targets.find((item) => item.id === targetId);
    const day = target?.days.find((item) => item.date === fixedDate);
    if (!target || !day || !assigneeUserId) return;
    const nonParticipant = !day.collaboratorUserIds.includes(assigneeUserId);
    if (nonParticipant && !window.confirm("측정 참여자가 아닌 직원을 고정 측정자로 선택했습니다. 그래도 확정하시겠습니까?")) return;
    setWorking(true);
    setError(null);
    try {
      await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_fixed", measurementDate, targetId, fixedDate, assigneeUserId,
          nonParticipantConfirmed: nonParticipant,
        }),
      });
      setNotice(`${target.code} 고정 측정자를 확정했습니다.`);
      await load(measurementDate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "고정 측정자 확정에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const releaseFixed = async (targetId: number, fixedDate: string) => {
    const target = snapshot?.targets.find((item) => item.id === targetId);
    const fixed = target?.fixedAssignments.find((item) => item.measurementDate === fixedDate && item.origin !== "automatic");
    if (!target || !fixed) return;
    if (!window.confirm("고정 측정자 지정을 해제하고 자동배정으로 전환하시겠습니까?")) return;
    setWorking(true);
    setError(null);
    setPreview(null);
    try {
      await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release_fixed", measurementDate, targetId, fixedDate }),
      });
      await load(measurementDate);
      setNotice(`${target.code} ${fixedDate} 고정 측정자를 자동으로 되돌렸습니다. 배정안을 다시 계산해 주세요.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "고정 측정자 자동 전환에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const createPreview = async () => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", measurementDate }),
      });
      setPreview(result);
      setReviewAdjustments(new Map());
      setReviewSuggestions([]);
      setSuggestionError(null);
      const protectedTargetIds = (result.snapshot?.targets ?? snapshot?.targets ?? [])
        .filter((target: PlannerTarget) => target.protected)
        .map((target: PlannerTarget) => target.id);
      if (protectedTargetIds.length) {
        const repair = await request("/api/preliminary-survey-v2/confirmed-document-repair", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "preview",
            targetIds: protectedTargetIds,
            measurementAssigneeSnapshots: (result.results ?? []).flatMap((item: ReversePlannerResult) =>
              item.publicSampleAssignments.map((assignment) => ({
                targetId: assignment.targetId,
                measurementDate: assignment.measurementDate,
                assigneeUserId: assignment.assigneeUserId,
              }))),
          }),
        });
        setRepairDrafts(repair.drafts ?? []);
      } else {
        setRepairDrafts([]);
      }
      setNotice("배정안을 계산했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "배정안 계산에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    setWorking(true);
    setError(null);
    try {
      const result = await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply", measurementDate, sourceFingerprint: preview.sourceFingerprint,
          previewToken: preview.previewToken, reviewAdjustments: [...reviewAdjustments.values()],
        }),
      });
      let repairedCount = 0;
      let repairError: string | null = null;
      const repairable: any[] = repairDrafts.filter((draft) => draft.classification === "MISSING_DOCUMENTARY_INFO");
      if (repairable.length) {
        try {
          const repairResult = await request("/api/preliminary-survey-v2/confirmed-document-repair", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "apply", targetIds: repairable.map((draft) => draft.targetId), drafts: repairable,
              measurementDate, reversePreviewToken: preview.previewToken }),
          });
          repairedCount = Number(repairResult.repairedCount ?? 0);
        } catch (caught) {
          repairError = caught instanceof Error ? caught.message : "확정자료 누락보정에 실패했습니다.";
        }
      }
      setPreview(null);
      setRepairDrafts([]);
      setReviewAdjustments(new Map());
      const appliedCount = Number(result.appliedCount ?? 0);
      try {
        await onApplied();
        setNotice(repairError
          ? `일반 자동배정 ${appliedCount}건은 완료되었습니다. 확정자료 ${repairable.length}건은 반영하지 못했습니다: ${repairError}`
          : `예비조사 ${appliedCount + repairedCount}건을 배정했습니다.`);
        onClose();
      } catch {
        setNotice(`예비조사 ${appliedCount}건의 배정은 완료되었습니다. 목록 새로고침에 실패했습니다. 다시 조회해 주세요.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "배정 확정에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  };


  const loadReviewSuggestions = async (targetId: number) => {
    if (!preview) return;
    setSuggestionsLoading(true);
    setSuggestionError(null);
    setReviewSuggestions([]);
    try {
      const result = await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest_adjustments",
          measurementDate,
          previewToken: preview.previewToken,
          targetId,
          reviewAdjustments: [...reviewAdjustments.values()],
        }),
      });
      setReviewSuggestions((result.suggestions ?? []) as ReviewSuggestion[]);
    } catch (caught) {
      setSuggestionError(caught instanceof Error ? caught.message : "추천 후보를 계산하지 못했습니다.");
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const openOverride = (targetId: number) => {
    const target = snapshot?.targets.find((item) => item.id === targetId);
    const result = preview?.results.find((item) => item.targetId === targetId);
    const repair = repairDrafts.find((item) => Number(item.targetId) === targetId) as any;
    const adjustment = reviewAdjustments.get(targetId);
    const candidate = result?.candidate;
    const plan = target?.existingPlan;
    const team = [...new Set(target?.days.flatMap((day) => [
      ...day.collaboratorUserIds,
      ...target.fixedAssignments.filter((fixed) => fixed.measurementDate === day.date).map((fixed) => fixed.assigneeUserId),
    ]) ?? [])];
    const participants = adjustment?.participantUserIds
      ?? candidate?.participantUserIds ?? plan?.participantUserIds ?? repair?.participantUserIds ?? team.slice(0, 1);
    setOverrideTargetId(targetId);
    setOverrideDate(adjustment?.preliminaryDate ?? candidate?.preliminaryDate ?? plan?.preliminaryDate ?? repair?.recommendedDate ?? "");
    setOverrideMethod(candidate?.surveyMethod ?? plan?.surveyMethod ?? repair?.surveyMethod
      ?? (target?.businessType === "existing" ? "phone" : "field"));
    setOverrideResponsible(candidate?.responsibleUserId ?? plan?.responsibleUserId ?? repair?.responsibleUserId ?? team[0] ?? null);
    setOverrideReviewer(candidate?.reviewerUserId ?? plan?.reviewerUserId ?? repair?.experiencedReviewerUserId ?? null);
    setOverrideParticipants(participants);
    setOverrideReason("");
    setOverrideViolations([]);
    setReviewSuggestions([]);
    setSuggestionError(null);
    setError(null);
    void loadReviewSuggestions(targetId);
  };

  const stageAdjustment = async () => {
    if (!preview || overrideTargetId == null) return;
    const adjustment: ReviewAdjustment = {
      targetId: overrideTargetId,
      preliminaryDate: overrideDate,
      participantUserIds: [...new Set(overrideParticipants)].sort((a, b) => a - b),
    };
    const next = new Map(reviewAdjustments);
    next.set(overrideTargetId, adjustment);
    setWorking(true);
    setError(null);
    setOverrideViolations([]);
    try {
      const response = await fetch("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate_adjustment",
          measurementDate,
          previewToken: preview.previewToken,
          reviewAdjustments: [...next.values()],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "수정안 검증에 실패했습니다.");
      if (!result.valid) {
        const targetViolations = result.violations?.[String(overrideTargetId)]
          ?? result.violations?.[overrideTargetId] ?? ["REVIEW_ADJUSTMENT_BATCH_CONFLICT"];
        setOverrideViolations(targetViolations);
        setError("수정안이 자동배정 지침을 통과하지 못했습니다. 값을 조정하거나 관리자 예외 처리를 검토해 주세요.");
        return;
      }
      setReviewAdjustments(next);
      setPreview((current) => current ? { ...current, results: result.results ?? current.results } : current);
      setOverrideTargetId(null);
      setNotice("수정안을 Preview에 반영했습니다. 배정 확정 전에는 저장되지 않습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수정안 검증에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const saveOverride = async () => {
    if (!preview || overrideTargetId == null) return;
    if (overrideViolations.length > 0
      && !window.confirm(`다음 지침 위반을 예외 처리합니다.\n\n${overrideViolations.map(violationText).join("\n")}\n\n계속하시겠습니까?`)) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "override", measurementDate, sourceFingerprint: preview.sourceFingerprint,
          previewToken: preview.previewToken, targetId: overrideTargetId,
          preliminaryDate: overrideDate, surveyMethod: overrideMethod,
          responsibleUserId: overrideResponsible, reviewerUserId: overrideReviewer,
          participantUserIds: overrideParticipants, overrideReason,
          acknowledgedViolations: overrideViolations,
        }),
      });
      const result = await response.json();
      if (response.status === 409 && result.code === "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED") {
        setOverrideViolations(result.violations ?? []);
        setError("아래 지침 위반사항을 확인한 뒤 예외 처리를 다시 실행해 주세요.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "예외 처리에 실패했습니다.");
      setPreview(null);
      setOverrideTargetId(null);
      try {
        await onApplied();
        setNotice("예외 처리를 저장했습니다.");
        await load(measurementDate);
      } catch {
        setNotice("예외 처리는 완료되었습니다. 목록 새로고침에 실패했습니다. 다시 조회해 주세요.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예외 처리에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const repairableCount = repairDrafts.filter((draft) => draft.classification === "MISSING_DOCUMENTARY_INFO").length;
  const autoResultCount = preview?.results.filter((result) => result.decision === "AUTO_ASSIGNED").length ?? 0;
  const adminOverrideKeptCount = preview?.results.filter((result) => result.decision === "ADMIN_OVERRIDE_KEPT").length ?? 0;
  const autoCount = autoResultCount + repairableCount;
  const reviewCount = (preview ? preview.results.length - autoResultCount - adminOverrideKeptCount : 0)
    + repairDrafts.filter((draft) => draft.classification !== "MISSING_DOCUMENTARY_INFO" && draft.classification !== "COMPLETE").length;
  const canApply = Boolean(preview?.results.some((result) => result.decision === "AUTO_ASSIGNED"
    && (result.mutation === "CREATE" || result.mutation === "REPLACE")) || repairableCount > 0 || reviewAdjustments.size > 0);
  const snapshotTargetCount = snapshot?.targets.length ?? 0;

  return <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={`${dateLabel(measurementDate)} 예비조사 자동 배정`}
    size="full"
    bodyScroll={false}
  >
    <div className={`${overrideTargetId != null ? "overflow-y-auto pr-1" : "overflow-hidden"} flex h-[calc(92vh-108px)] min-h-0 flex-col gap-2 pt-2`} data-testid="preliminary-survey-auto-assignment-modal">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 p-2">
        <Button size="sm" variant="secondary" onClick={() => changeMeasurementDate(moveDate(measurementDate, -1))} disabled={working}>◀ 이전일</Button>
        <input aria-label="자동 배정 실제 측정일" type="date" value={measurementDate}
          onChange={(event) => changeMeasurementDate(event.target.value)}
          className="h-9 rounded-md border border-surface-300 bg-white px-3 text-sm font-medium" />
        <Button size="sm" variant="secondary" onClick={() => changeMeasurementDate(moveDate(measurementDate, 1))} disabled={working}>다음일 ▶</Button>
        <span className="text-sm font-medium text-text-700">대상 사업장 {snapshot?.targets.length ?? 0}개</span>
        <div className="ml-auto flex items-center gap-3">
          {preview && <div className="text-sm text-text-700"><strong className="text-emerald-700">배정 가능 {autoCount}건</strong>{adminOverrideKeptCount > 0 && <span className="ml-3 font-medium text-blue-700">관리자 지정 유지 {adminOverrideKeptCount}건</span>}{reviewCount > 0 && <span className="ml-3 font-medium text-amber-700">확인 필요 {reviewCount}건</span>}</div>}
          <Button size="sm" onClick={createPreview} disabled={working || !snapshot?.targets.length}>배정안 계산</Button>
          <Button size="sm" onClick={applyPreview} disabled={working || !canApply}>배정 확정</Button>
        </div>
      </div>

      {notice && <p className="text-sm font-medium text-emerald-700" role="status">{notice}</p>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}
      {preview?.routeProviderConfigured === false && Number(preview.routeStats?.requiredPairs ?? 0) > 0 && <div data-testid="preliminary-survey-route-provider-warning" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">현재 Preview 환경에 Kakao 차량동선 API가 설정되지 않아 이동경로 대상은 자동 판정할 수 없습니다. 운영 데이터 문제와 구분하여 환경 설정을 확인해 주세요.</div>}

      <div data-testid="preliminary-survey-auto-assignment-table-scroll"
        data-vertical-scroll={snapshotTargetCount > 8 ? "enabled" : "disabled"}
        className={`${snapshotTargetCount > 8 ? "min-h-0 flex-1 overflow-auto" : "shrink-0 overflow-x-auto overflow-y-hidden"} rounded-lg border border-surface-200 bg-white`}>
        <table className="w-full min-w-[1180px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface-100 text-text-700 shadow-sm">
            <tr>
              <th className="w-48 px-2 py-2">사업장</th>
              <th className="w-28 px-2 py-2">측정예정일</th>
              <th className="w-48 px-2 py-2">측정자(공시료)</th>
              <th className="w-36 px-2 py-2">측정 참여자</th>
              <th className="w-28 px-2 py-2">보고서 담당</th>
              <th className="w-28 bg-primary-50 px-2 py-2 text-primary-900">예비조사일</th>
              <th className="w-40 bg-primary-50 px-2 py-2 text-primary-900">예비조사자</th>
              <th className="w-20 px-2 py-2">방식</th>
              <th className="w-40 px-2 py-2">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200">
            {(snapshot?.targets ?? []).map((target) => {
              const result = preview?.results.find((item) => item.targetId === target.id);
              const repair = repairDrafts.find((item) => Number(item.targetId) === target.id) as any;
              const candidate = result?.candidate;
              const plan = target.existingPlan;
              const preliminaryDate = candidate?.preliminaryDate ?? plan?.preliminaryDate ?? repair?.recommendedDate ?? null;
              const surveyorIds = candidate?.participantUserIds ?? plan?.participantUserIds ?? repair?.participantUserIds ?? [];
              const method = candidate?.surveyMethod ?? plan?.surveyMethod ?? repair?.surveyMethod ?? null;
              const status = repair?.classification === "MISSING_DOCUMENTARY_INFO"
                ? { label: "누락정보 보정 가능", tone: "text-emerald-800 bg-emerald-50" }
                : repair?.classification === "PROTECTED_MANUAL"
                  ? { label: "기존 확정값 확인 필요", tone: "text-amber-800 bg-amber-50" }
                  : repair?.classification === "NEEDS_MANUAL_REVIEW"
                    ? { label: "원천정보 확인 필요", tone: "text-amber-800 bg-amber-50" }
                    : resultStatus(result, target);
              const routeWarnings = collapseRouteWarnings((preview?.routeEvidence ?? [])
                .filter((item) => (item.leftTargetId === target.id || item.rightTargetId === target.id)
                  && !item.sameAddress && (item.durationMinutes == null || item.durationMinutes > 30))
                .map((item) => {
                  const otherId = item.leftTargetId === target.id ? item.rightTargetId : item.leftTargetId;
                  const otherTarget = snapshot?.targets.find((entry) => entry.id === otherId);
                  const otherOccupancy = [...(snapshot?.actualMeasurementOccupancy ?? []), ...(snapshot?.existingSurveyOccupancy ?? [])]
                    .find((entry) => entry.targetId === otherId);
                  const otherLabel = otherTarget ? `${otherTarget.code} ${otherTarget.name}`
                    : otherOccupancy?.businessCode ?? `대상 ${otherId}`;
                  const sharedNames = (item.sharedUserIds ?? []).map((id) => userById.get(id)?.name).filter(Boolean).join(" · ");
                  const label = item.durationMinutes == null ? "이동경로 확인 필요"
                    : item.durationMinutes <= 60 ? `동선 검토 ${item.durationMinutes}분`
                      : `동선 불가 ${item.durationMinutes}분`;
                  const detail = `${item.date} · ${otherLabel}${sharedNames ? ` · 공통 ${sharedNames}` : ""}`
                    + ` · 정방향 ${item.forwardDurationMinutes ?? "-"}분 · 역방향 ${item.reverseDurationMinutes ?? "-"}분`
                    + ` · 적용 ${item.effectiveDurationMinutes ?? item.durationMinutes ?? "-"}분`;
                  return { label, detail };
                }));
              const isReviewAdjusted = reviewAdjustments.has(target.id);
              const valueSourceLabel = isReviewAdjusted ? "수정안"
                : result?.decision === "ADMIN_OVERRIDE_KEPT" ? "관리자 지정"
                  : result?.decision === "AUTO_ASSIGNED" && result.mutation === "KEEP_EXISTING" ? "기존값 유지"
                    : candidate ? "자동계산" : plan ? "기존값" : repair ? "보정안" : "미계산";
              const visibleRouteWarnings = routeWarnings.filter((warning) => warning.label !== status.label);
              return <tr key={target.id} className={result && result.decision !== "AUTO_ASSIGNED" && result.decision !== "ADMIN_OVERRIDE_KEPT" ? "bg-amber-50/40 align-top" : "align-top"}>
                <td className="px-2 py-2"><div className="font-semibold text-text-900">{target.code}</div><div className="truncate text-text-700" title={target.name}>{target.name}</div><div className="mt-1 flex flex-wrap gap-1 text-[11px]"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{businessTypeLabel[target.businessType]}</span><span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">{valueSourceLabel}</span></div></td>
                <td className="px-2 py-2 text-text-700">{target.days.map((day) => <div key={day.date}>{day.date}</div>)}</td>
                <td className="space-y-1 px-2 py-2">{target.days.map((day) => {
                  const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date);
                  const automatic = result?.publicSampleAssignments.find((item) => item.measurementDate === day.date);
                  const priority = [...new Set([...day.collaboratorUserIds, ...snapshot!.users.map((user) => user.id)])]
                    .map((id) => userById.get(id)).filter(Boolean);
                  return <div key={day.date} className="flex items-center gap-1">
                    <select aria-label={`${target.code} ${day.date} 고정 측정자`} value={fixed?.assigneeUserId ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value) void confirmFixed(target.id, day.date, Number(value));
                        else if (fixed) void releaseFixed(target.id, day.date);
                      }}
                      disabled={working}
                      className="h-8 min-w-0 flex-1 rounded-md border border-surface-300 bg-white px-2 text-sm">
                      <option value="">자동</option>
                      {priority.map((user) => user && <option key={user.id} value={user.id}>{user.name}({user.baseCode ?? "-"}){day.collaboratorUserIds.includes(user.id) ? " · 참여" : ""}</option>)}
                    </select>
                    {fixed && <span className="shrink-0 text-xs font-semibold text-emerald-700" title="고정 측정자">✓</span>}
                    {!fixed && automatic && <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-primary-700" title={`자동 · ${userById.get(automatic.assigneeUserId)?.name ?? "-"}(${automatic.publicSampleCode})`}>자동 {userById.get(automatic.assigneeUserId)?.name ?? "-"}</span>}
                    {fixed?.nonParticipantConfirmed && <span className="shrink-0 text-xs font-semibold text-amber-700" title="측정 참여자가 아닌 직원을 선택했습니다.">⚠</span>}
                  </div>;
                })}</td>
                <td className="px-2 py-2 text-text-700">{target.days.map((day) => <div key={day.date}>{day.collaboratorUserIds.map((id) => userById.get(id)?.name).filter(Boolean).join(" · ") || "-"}</div>)}</td>
                <td className="px-2 py-2 text-text-700">{target.days.map((day) => <div key={day.date}>{day.reportWriterUserId == null ? "-" : userById.get(day.reportWriterUserId)?.name ?? "-"}</div>)}</td>
                <td className="bg-primary-50/50 px-2 py-2 text-base font-bold text-primary-900">{preliminaryDate ?? "-"}</td>
                <td className="bg-primary-50/50 px-2 py-2 text-base font-bold text-primary-900">{participantText(surveyorIds)}</td>
                <td className="px-2 py-2 font-medium">{method === "field" ? "방문" : method === "phone" ? "유선" : "-"}</td>
                <td className="px-2 py-2"><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${isReviewAdjusted ? "bg-blue-50 text-blue-800" : status.tone}`}>{isReviewAdjusted ? "수정안" : status.label}</span>
                  {preview && result?.decision !== "SOURCE_INVALID" && !target.protected && <button type="button" className="text-xs font-medium text-primary-700 underline" onClick={() => openOverride(target.id)}>수정</button>}</div>
                  {visibleRouteWarnings.length > 0 && <div className="mt-1 space-y-0.5 text-xs font-medium text-amber-700">{visibleRouteWarnings.map((warning) => <div key={warning.label} title={warning.detail}>{warning.label}</div>)}</div>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
        {!working && snapshot?.targets.length === 0 && <div className="p-10 text-center text-sm text-text-500">이 측정일에 자동 배정할 사업장이 없습니다.</div>}
        {working && <div className="p-10 text-center text-sm text-text-500">불러오는 중...</div>}
      </div>

      {overrideTargetId != null && <div className="rounded-lg border border-primary-200 bg-primary-50/30 p-4">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-text-900">배정안 수정</h3><p className="mt-1 text-xs text-text-600">정상 수정안은 Preview에만 반영되며 배정 확정 전에는 저장되지 않습니다.</p></div><button type="button" className="text-sm text-text-600" onClick={() => setOverrideTargetId(null)}>닫기</button></div>
        <div className="mb-3 rounded-md border border-surface-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold text-text-900">지침에 맞는 추천 후보</div><div className="text-xs text-text-500">최대 3개</div></div>
          {suggestionsLoading && <p className="mt-2 text-sm text-text-500">현재 일정·인원·동선을 기준으로 후보를 확인하는 중...</p>}
          {suggestionError && <p className="mt-2 text-sm font-medium text-amber-700">{suggestionError}</p>}
          {!suggestionsLoading && !suggestionError && reviewSuggestions.length === 0 && <p className="mt-2 text-sm text-text-600">현재 batch에서 자동 지침을 통과한 추천 후보가 없습니다. 아래 직접 수정에서 값을 지정해 검증해 주세요.</p>}
          {reviewSuggestions.length > 0 && <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">{reviewSuggestions.map((suggestion, index) => <button type="button" key={`${suggestion.preliminaryDate}-${suggestion.participantUserIds.join("-")}`} onClick={() => { setOverrideDate(suggestion.preliminaryDate); setOverrideMethod(suggestion.surveyMethod); setOverrideParticipants(suggestion.participantUserIds); setOverrideViolations([]); }} className="rounded-md border border-primary-200 bg-primary-50/40 p-3 text-left hover:border-primary-400 hover:bg-primary-50">
            <div className="text-xs font-bold text-primary-700">{index + 1}순위</div>
            <div className="mt-1 font-semibold text-text-900">{suggestion.preliminaryDate} · {suggestion.surveyMethod === "field" ? "방문" : "유선"}</div>
            <div className="mt-1 text-sm text-text-700">{participantText(suggestion.participantUserIds)}</div>
            <div className="mt-1 text-xs text-text-500">{suggestionReason(suggestion.reasons)}</div>
          </button>)}</div>}
        </div>
        <div className="mb-2 text-sm font-semibold text-text-900">직접 수정</div>
        {overrideViolations.length > 0 && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><div className="font-medium">확인할 위반사항</div><ul className="mt-1 list-disc pl-5">{overrideViolations.map((violation) => <li key={violation}>{violationText(violation)}</li>)}</ul></div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">예비조사일<input type="date" value={overrideDate} onChange={(event) => { setOverrideDate(event.target.value); setOverrideViolations([]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2" /></label>
          <div className="text-sm">방식<div className="mt-1 flex h-9 items-center rounded border border-surface-200 bg-surface-50 px-2 font-medium">{overrideMethod === "field" ? "방문" : "유선"} · 업체 구분 기준 고정</div></div>
        </div>
        <fieldset className="mt-3"><legend className="text-sm font-medium">예비조사자</legend><div className="mt-2 flex flex-wrap gap-3">{snapshot?.users.filter((user) => user.active).map((user) => <label key={user.id} className="text-sm"><input type="checkbox" checked={overrideParticipants.includes(user.id)} onChange={(event) => { setOverrideViolations([]); setOverrideParticipants((current) => event.target.checked ? [...new Set([...current, user.id])] : current.filter((id) => id !== user.id)); }} /> {user.name}</label>)}</div></fieldset>
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={stageAdjustment} disabled={working || !overrideDate || !overrideParticipants.length}>수정안 검증</Button></div>
        {canOverride && overrideViolations.length > 0 && <div className="mt-4 border-t border-amber-300 pt-4">
          <div className="mb-2 text-sm font-semibold text-amber-900">관리자 예외 처리</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-sm">방식<select value={overrideMethod} onChange={(event) => setOverrideMethod(event.target.value as "field" | "phone")} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="field">방문</option><option value="phone">유선</option></select></label>
            <label className="text-sm">작성자<select value={overrideResponsible ?? ""} onChange={(event) => { const id = Number(event.target.value); setOverrideResponsible(id); setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">선택</option>{snapshot?.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <label className="text-sm">검토자<select value={overrideReviewer ?? ""} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : null; setOverrideReviewer(id); if (id) setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">없음</option>{snapshot?.users.filter((user) => user.active && user.experienced).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          </div>
          <label className="mt-3 block text-sm">예외 사유<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-surface-300 bg-white p-2" placeholder="구체적인 업무상 예외 사유" /></label>
          <div className="mt-3 flex justify-end"><Button size="sm" variant="danger" onClick={saveOverride} disabled={working || !overrideDate || !overrideResponsible || !overrideParticipants.length || !overrideReason.trim()}>관리자 예외로 즉시 저장</Button></div>
        </div>}
      </div>}

      <div className="mt-auto flex justify-end"><Button variant="secondary" onClick={onClose} disabled={working}>닫기</Button></div>
    </div>
  </Modal>;
}
