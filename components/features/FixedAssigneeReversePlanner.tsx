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
};

function resultStatus(result: ReversePlannerResult | undefined, target: PlannerTarget) {
  if (!result) return target.existingPlan
    ? { label: "기존 확정", tone: "text-slate-700 bg-slate-100" }
    : { label: "계산 전", tone: "text-slate-600 bg-slate-100" };
  if (result.decision === "AUTO_ASSIGNED") return result.mutation === "KEEP_EXISTING"
    ? { label: "기존 확정", tone: "text-emerald-800 bg-emerald-50" }
    : { label: "배정 가능", tone: "text-emerald-800 bg-emerald-50" };
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
};

const violationText = (value: string) => violationLabels[value] ?? "운영지침 확인이 필요합니다.";

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
      const protectedTargetIds = (result.snapshot?.targets ?? snapshot?.targets ?? [])
        .filter((target: PlannerTarget) => target.protected)
        .map((target: PlannerTarget) => target.id);
      if (protectedTargetIds.length) {
        const repair = await request("/api/preliminary-survey-v2/confirmed-document-repair", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", targetIds: protectedTargetIds }),
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
          previewToken: preview.previewToken,
        }),
      });
      let repairedCount = 0;
      let repairError: string | null = null;
      const repairable: any[] = repairDrafts.filter((draft) => draft.classification === "MISSING_DOCUMENTARY_INFO");
      if (repairable.length) {
        try {
          const repairResult = await request("/api/preliminary-survey-v2/confirmed-document-repair", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "apply", targetIds: repairable.map((draft) => draft.targetId), drafts: repairable }),
          });
          repairedCount = Number(repairResult.repairedCount ?? 0);
        } catch (caught) {
          repairError = caught instanceof Error ? caught.message : "확정자료 누락보정에 실패했습니다.";
        }
      }
      setPreview(null);
      setRepairDrafts([]);
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

  const openOverride = (targetId: number) => {
    const target = snapshot?.targets.find((item) => item.id === targetId);
    const team = [...new Set(target?.days.flatMap((day) => [
      ...day.collaboratorUserIds,
      ...target.fixedAssignments.filter((fixed) => fixed.measurementDate === day.date).map((fixed) => fixed.assigneeUserId),
    ]) ?? [])];
    setOverrideTargetId(targetId);
    setOverrideDate("");
    setOverrideMethod(target?.businessType === "existing" ? "phone" : "field");
    setOverrideResponsible(team[0] ?? null);
    setOverrideReviewer(null);
    setOverrideParticipants(team[0] ? [team[0]] : []);
    setOverrideReason("");
    setOverrideViolations([]);
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
  const autoCount = (preview?.results.filter((result) => result.decision === "AUTO_ASSIGNED").length ?? 0) + repairableCount;
  const reviewCount = (preview ? preview.results.length - (preview.results.filter((result) => result.decision === "AUTO_ASSIGNED").length) : 0)
    + repairDrafts.filter((draft) => draft.classification !== "MISSING_DOCUMENTARY_INFO" && draft.classification !== "COMPLETE").length;
  const canApply = Boolean(preview?.results.some((result) => result.decision === "AUTO_ASSIGNED"
    && (result.mutation === "CREATE" || result.mutation === "REPLACE")) || repairableCount > 0);

  return <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={`${dateLabel(measurementDate)} 예비조사 자동 배정`}
    size="full"
  >
    <div className="space-y-4 pt-4" data-testid="preliminary-survey-auto-assignment-modal">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 p-3">
        <Button size="sm" variant="secondary" onClick={() => changeMeasurementDate(moveDate(measurementDate, -1))} disabled={working}>◀ 이전일</Button>
        <input aria-label="자동 배정 실제 측정일" type="date" value={measurementDate}
          onChange={(event) => changeMeasurementDate(event.target.value)}
          className="h-9 rounded-md border border-surface-300 bg-white px-3 text-sm font-medium" />
        <Button size="sm" variant="secondary" onClick={() => changeMeasurementDate(moveDate(measurementDate, 1))} disabled={working}>다음일 ▶</Button>
        <span className="text-sm font-medium text-text-700">대상 사업장 {snapshot?.targets.length ?? 0}개</span>
        <div className="ml-auto flex items-center gap-3">
          {preview && <div className="text-sm text-text-700"><strong className="text-emerald-700">배정 가능 {autoCount}건</strong>{reviewCount > 0 && <span className="ml-3 font-medium text-amber-700">확인 필요 {reviewCount}건</span>}</div>}
          <Button size="sm" onClick={createPreview} disabled={working || !snapshot?.targets.length}>배정안 계산</Button>
          <Button size="sm" onClick={applyPreview} disabled={working || !canApply}>배정 확정</Button>
        </div>
      </div>

      {notice && <p className="text-sm font-medium text-emerald-700" role="status">{notice}</p>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}

      <div className="max-h-[55vh] overflow-auto rounded-lg border border-surface-200 bg-white">
        <table className="w-full min-w-[1180px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface-100 text-text-700 shadow-sm">
            <tr>
              <th className="w-48 px-3 py-3">사업장</th>
              <th className="w-28 px-3 py-3">측정예정일</th>
              <th className="w-48 px-3 py-3">측정자(공시료)</th>
              <th className="w-36 px-3 py-3">측정 참여자</th>
              <th className="w-28 px-3 py-3">보고서 담당</th>
              <th className="w-28 bg-primary-50 px-3 py-3 text-primary-900">예비조사일</th>
              <th className="w-40 bg-primary-50 px-3 py-3 text-primary-900">예비조사자</th>
              <th className="w-20 px-3 py-3">방식</th>
              <th className="w-40 px-3 py-3">상태</th>
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
              const routeLabels = [...new Set((preview?.routeEvidence ?? [])
                .filter((item) => item.leftTargetId === target.id || item.rightTargetId === target.id)
                .map((item) => item.sameAddress ? "동일주소"
                  : item.durationMinutes == null ? "이동경로 확인 필요"
                    : item.durationMinutes <= 30 ? `차량 ${item.durationMinutes}분`
                      : `차량 ${item.durationMinutes}분 · 추가 검토`))];
              return <tr key={target.id} className={result && result.decision !== "AUTO_ASSIGNED" ? "bg-amber-50/40 align-top" : "align-top"}>
                <td className="px-3 py-3"><div className="font-semibold text-text-900">{target.code}</div><div className="truncate text-text-700" title={target.name}>{target.name}</div></td>
                <td className="px-3 py-3 text-text-700">{target.days.map((day) => <div key={day.date}>{day.date}</div>)}</td>
                <td className="space-y-2 px-3 py-3">{target.days.map((day) => {
                  const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date);
                  const automatic = result?.publicSampleAssignments.find((item) => item.measurementDate === day.date);
                  const priority = [...new Set([...day.collaboratorUserIds, ...snapshot!.users.map((user) => user.id)])]
                    .map((id) => userById.get(id)).filter(Boolean);
                  return <div key={day.date}>
                    <select aria-label={`${target.code} ${day.date} 고정 측정자`} value={fixed?.assigneeUserId ?? ""}
                      onChange={(event) => event.target.value
                        ? void confirmFixed(target.id, day.date, Number(event.target.value))
                        : undefined}
                      className="h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
                      <option value="" disabled={Boolean(fixed)}>자동</option>
                      {priority.map((user) => user && <option key={user.id} value={user.id}>{user.name}({user.baseCode ?? "-"}){day.collaboratorUserIds.includes(user.id) ? " · 참여" : ""}</option>)}
                    </select>
                    {fixed && <div className="mt-1 text-xs font-medium text-emerald-700">✓ 고정</div>}
                    {!fixed && automatic && <div className="mt-1 text-xs font-medium text-primary-700">자동 · {userById.get(automatic.assigneeUserId)?.name ?? "-"}({automatic.publicSampleCode})</div>}
                    {fixed?.nonParticipantConfirmed && <div className="mt-1 text-xs font-medium text-amber-700">⚠ 측정 참여자가 아닌 직원을 선택했습니다.</div>}
                  </div>;
                })}</td>
                <td className="px-3 py-3 text-text-700">{target.days.map((day) => <div key={day.date}>{day.collaboratorUserIds.map((id) => userById.get(id)?.name).filter(Boolean).join(" · ") || "-"}</div>)}</td>
                <td className="px-3 py-3 text-text-700">{target.days.map((day) => <div key={day.date}>{day.reportWriterUserId == null ? "-" : userById.get(day.reportWriterUserId)?.name ?? "-"}</div>)}</td>
                <td className="bg-primary-50/50 px-3 py-3 text-base font-bold text-primary-900">{preliminaryDate ?? "-"}</td>
                <td className="bg-primary-50/50 px-3 py-3 text-base font-bold text-primary-900">{participantText(surveyorIds)}</td>
                <td className="px-3 py-3 font-medium">{method === "field" ? "방문" : method === "phone" ? "유선" : "-"}</td>
                <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                  {routeLabels.length > 0 && <div className="mt-2 text-xs text-text-600">{routeLabels.join(" · ")}</div>}
                  {canOverride && result?.decision === "MANUAL_REQUIRED" && <button type="button" className="mt-2 text-xs font-medium text-primary-700 underline" onClick={() => openOverride(target.id)}>예외 처리</button>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
        {!working && snapshot?.targets.length === 0 && <div className="p-10 text-center text-sm text-text-500">이 측정일에 자동 배정할 사업장이 없습니다.</div>}
        {working && <div className="p-10 text-center text-sm text-text-500">불러오는 중...</div>}
      </div>

      {overrideTargetId != null && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-amber-900">예외 처리</h3><button type="button" className="text-sm text-text-600" onClick={() => setOverrideTargetId(null)}>닫기</button></div>
        {overrideViolations.length > 0 && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><div className="font-medium">확인할 위반사항</div><ul className="mt-1 list-disc pl-5">{overrideViolations.map((violation) => <li key={violation}>{violationText(violation)}</li>)}</ul></div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-sm">예비조사일<input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2" /></label>
          <label className="text-sm">방식<select value={overrideMethod} onChange={(event) => setOverrideMethod(event.target.value as "field" | "phone")} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="field">방문</option><option value="phone">유선</option></select></label>
          <label className="text-sm">작성자<select value={overrideResponsible ?? ""} onChange={(event) => { const id = Number(event.target.value); setOverrideResponsible(id); setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">선택</option>{snapshot?.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label className="text-sm">검토자<select value={overrideReviewer ?? ""} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : null; setOverrideReviewer(id); if (id) setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">없음</option>{snapshot?.users.filter((user) => user.active && user.experienced).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        </div>
        <fieldset className="mt-3"><legend className="text-sm font-medium">예비조사자</legend><div className="mt-2 flex flex-wrap gap-3">{snapshot?.users.filter((user) => user.active).map((user) => <label key={user.id} className="text-sm"><input type="checkbox" checked={overrideParticipants.includes(user.id)} onChange={(event) => setOverrideParticipants((current) => event.target.checked ? [...new Set([...current, user.id])] : current.filter((id) => id !== user.id))} /> {user.name}</label>)}</div></fieldset>
        <label className="mt-3 block text-sm">예외 사유<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-surface-300 bg-white p-2" placeholder="구체적인 업무상 예외 사유" /></label>
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={saveOverride} disabled={working || !overrideDate || !overrideResponsible || !overrideParticipants.length || !overrideReason.trim()}>{overrideViolations.length > 0 ? "위반 확인 후 저장" : "위반 검증"}</Button></div>
      </div>}

      <div className="flex justify-end"><Button variant="secondary" onClick={onClose} disabled={working}>닫기</Button></div>
    </div>
  </Modal>;
}
