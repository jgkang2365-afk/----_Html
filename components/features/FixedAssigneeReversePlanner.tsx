"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type {
  PlanningSnapshot,
  ReversePlannerOutput,
} from "@/lib/preliminary-survey-v2/reverse-planner/types";

const todayInKst = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const decisionLabel = {
  AUTO_ASSIGNED: "자동 결정",
  MANUAL_REQUIRED: "수동 확인",
  SOURCE_INVALID: "원천 오류",
} as const;

export function FixedAssigneeReversePlanner() {
  const [measurementDate, setMeasurementDate] = useState(todayInKst());
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [preview, setPreview] = useState<ReversePlannerOutput | null>(null);
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

  const userById = useMemo(() => new Map((snapshot?.users ?? []).map((user) => [user.id, user])), [snapshot]);
  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "역산 플래너 요청 실패");
    return result;
  }, []);
  const load = useCallback(async () => {
    setWorking(true); setError(null); setNotice(null); setPreview(null);
    try {
      const result = await request(`/api/preliminary-survey-v2/reverse-planner?measurementDate=${measurementDate}`);
      setSnapshot(result.snapshot);
      setCanOverride(result.canOverride === true);
      setNotice(result.snapshot.targets.length
        ? `실제 측정일 ${measurementDate} 전체 ${result.snapshot.targets.length}개 사업장을 불러왔습니다.`
        : "해당 실제 측정일의 사업장이 없습니다.");
    } catch (caught) {
      setSnapshot(null);
      setError(caught instanceof Error ? caught.message : "역산 플래너 조회 실패");
    } finally { setWorking(false); }
  }, [measurementDate, request]);
  useEffect(() => { void load(); }, [load]);

  const confirmFixed = async (targetId: number, fixedDate: string, assigneeUserId: number) => {
    const target = snapshot?.targets.find((item) => item.id === targetId);
    const day = target?.days.find((item) => item.date === fixedDate);
    if (!target || !day || !assigneeUserId) return;
    if (!day.collaboratorUserIds.includes(assigneeUserId)
      && !window.confirm("측정 참여자에 포함되지 않은 측정자입니다. 그래도 확정하시겠습니까?")) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_fixed", measurementDate, targetId, fixedDate, assigneeUserId }),
      });
      setNotice(`${target.code} ${fixedDate} 고정 측정자를 확정했습니다. 이전 Preview는 폐기되었습니다.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "측정자 확정 실패");
    } finally { setWorking(false); }
  };

  const createPreview = async () => {
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", measurementDate }),
      });
      setPreview(result);
      setNotice("역산 Preview를 생성했습니다. 아직 업무 데이터는 저장되지 않았습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preview 생성 실패");
    } finally { setWorking(false); }
  };

  const applyPreview = async () => {
    if (!preview) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      const result = await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", measurementDate, sourceFingerprint: preview.sourceFingerprint }),
      });
      setPreview(null);
      setNotice(`정상안 ${Number(result.appliedCount ?? 0)}건을 원자적으로 적용했습니다.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정상안 적용 실패");
    } finally { setWorking(false); }
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
  };

  const saveOverride = async () => {
    if (!preview || overrideTargetId == null) return;
    setWorking(true); setError(null);
    try {
      await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "override", measurementDate, sourceFingerprint: preview.sourceFingerprint,
          targetId: overrideTargetId, preliminaryDate: overrideDate, surveyMethod: overrideMethod,
          responsibleUserId: overrideResponsible, reviewerUserId: overrideReviewer,
          participantUserIds: overrideParticipants, overrideReason,
        }),
      });
      setOverrideTargetId(null); setPreview(null);
      setNotice("관리자 예외를 경고·사유·before/after audit과 함께 저장했습니다.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "관리자 예외 저장 실패");
    } finally { setWorking(false); }
  };

  return (
    <Card className="space-y-3 border-primary-200 bg-primary-50/30 p-3" data-testid="fixed-assignee-reverse-planner">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-text-900">측정자 고정형 역산 플래너</h3>
          <p className="text-xs text-text-600">실제 측정일별 측정자를 먼저 확정한 뒤 예비조사 계획을 역산합니다.</p>
        </div>
        <label className="text-xs font-medium text-text-700">실제 측정일
          <input aria-label="역산 플래너 실제 측정일" type="date" value={measurementDate}
            onChange={(event) => { setMeasurementDate(event.target.value); setSnapshot(null); setPreview(null); }}
            className="ml-2 h-9 rounded-md border border-surface-300 bg-white px-2 text-sm" />
        </label>
        <Button size="sm" variant="secondary" onClick={load} disabled={working}>대상 조회</Button>
        <Button size="sm" onClick={createPreview} disabled={working || !snapshot?.targets.length}>역산 Preview</Button>
        <Button size="sm" onClick={applyPreview}
          disabled={working || !preview || !preview.results.some((result) => result.decision === "AUTO_ASSIGNED" && result.mutation !== "KEEP_EXISTING")}>
          정상안 적용
        </Button>
      </div>
      <Alert variant="warning">구형 측정자 자동추천은 UI와 서버에서 중지되었습니다. 이 화면의 명시적 고정값만 사용합니다.</Alert>
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}
      {snapshot && snapshot.targets.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-surface-200 bg-white">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead className="sticky top-0 bg-surface-100 text-text-700">
              <tr><th className="p-2">사업장</th><th className="p-2">고정 측정자(공시료)</th>
                <th className="p-2">측정 참여자</th><th className="p-2">보고서 담당</th>
                <th className="p-2">예비조사 결과</th><th className="p-2">작성자 / reviewer</th></tr>
            </thead>
            <tbody>
              {snapshot.targets.map((target) => {
                const result = preview?.results.find((item) => item.targetId === target.id);
                return <tr key={target.id} className="border-t border-surface-200 align-top">
                  <td className="p-2 font-medium">{target.code}<br /><span className="font-normal text-text-600">{target.name}</span></td>
                  <td className="space-y-2 p-2">{target.days.map((day) => {
                    const fixed = target.fixedAssignments.find((item) => item.measurementDate === day.date);
                    const priority = [...new Set([...day.collaboratorUserIds, ...snapshot.users.map((user) => user.id)])]
                      .map((id) => userById.get(id)).filter(Boolean);
                    return <div key={day.date} className="flex items-center gap-1">
                      <span className="w-20 shrink-0">{day.date.slice(5)}</span>
                      <select aria-label={`${target.code} ${day.date} 고정 측정자`}
                        value={fixed?.assigneeUserId ?? ""}
                        onChange={(event) => void confirmFixed(target.id, day.date, Number(event.target.value))}
                        className="h-8 min-w-32 rounded border border-surface-300 bg-white px-1">
                        <option value="">미확정</option>
                        {priority.map((user) => user && <option key={user.id} value={user.id}>
                          {user.name}({user.baseCode ?? "-"}){day.collaboratorUserIds.includes(user.id) ? " · 참여" : ""}
                        </option>)}
                      </select>
                    </div>;
                  })}</td>
                  <td className="space-y-1 p-2">{target.days.map((day) =>
                    <div key={day.date}>{day.date.slice(5)} {day.collaboratorUserIds.map((id) => userById.get(id)?.name).filter(Boolean).join(", ") || "-"}</div>
                  )}</td>
                  <td className="space-y-1 p-2">{target.days.map((day) =>
                    <div key={day.date}>{day.date.slice(5)} {day.reportWriterUserId == null ? "-" : userById.get(day.reportWriterUserId)?.name ?? "-"}</div>
                  )}</td>
                  <td className="p-2">{result ? <>
                    <span className={result.decision === "AUTO_ASSIGNED" ? "text-emerald-700" : result.decision === "MANUAL_REQUIRED" ? "text-amber-700" : "text-red-700"}>
                      {decisionLabel[result.decision]} · {result.mutation}
                    </span>
                    <div>{result.candidate?.preliminaryDate ?? result.reason ?? "-"}</div>
                    <div>{result.candidate?.participantUserIds.map((id) => userById.get(id)?.name).filter(Boolean).join(", ") ?? "-"}</div>
                    {canOverride && result.decision === "MANUAL_REQUIRED"
                      && <button type="button" className="mt-1 text-red-700 underline" onClick={() => openOverride(target.id)}>관리자 예외</button>}
                  </> : "Preview 전"}</td>
                  <td className="p-2">{result?.candidate ? <>
                    <div>작성: {userById.get(result.candidate.writerUserId)?.name ?? "-"}</div>
                    <div>reviewer: {result.candidate.reviewerUserId == null ? "-" : userById.get(result.candidate.reviewerUserId)?.name ?? "-"}</div>
                  </> : "-"}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      {overrideTargetId != null && <Modal isOpen onClose={() => setOverrideTargetId(null)} title="관리자 예외 저장" size="lg">
        <div className="space-y-4">
          <Alert variant="warning">
            Canonical 자동결정 범위를 벗어나는 값입니다. 존재하지 않는 사용자·날짜 구조 오류·stale source는 관리자도 저장할 수 없습니다.
          </Alert>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">예비조사일<input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)}
              className="mt-1 block h-9 w-full rounded border border-surface-300 px-2" /></label>
            <label className="text-sm">방식<select value={overrideMethod} onChange={(event) => setOverrideMethod(event.target.value as "field" | "phone")}
              className="mt-1 block h-9 w-full rounded border border-surface-300 px-2"><option value="field">방문</option><option value="phone">유선</option></select></label>
            <label className="text-sm">작성자 / responsible<select value={overrideResponsible ?? ""} onChange={(event) => {
              const id = Number(event.target.value); setOverrideResponsible(id); setOverrideParticipants((current) => [...new Set([...current, id])]);
            }} className="mt-1 block h-9 w-full rounded border border-surface-300 px-2"><option value="">선택</option>
              {snapshot?.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <label className="text-sm">reviewer<select value={overrideReviewer ?? ""} onChange={(event) => {
              const id = event.target.value ? Number(event.target.value) : null; setOverrideReviewer(id);
              if (id) setOverrideParticipants((current) => [...new Set([...current, id])]);
            }} className="mt-1 block h-9 w-full rounded border border-surface-300 px-2"><option value="">없음</option>
              {snapshot?.users.filter((user) => user.active && user.experienced).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          </div>
          <fieldset><legend className="text-sm font-medium">예비조사자</legend><div className="mt-2 flex flex-wrap gap-3">
            {snapshot?.users.filter((user) => user.active).map((user) => <label key={user.id} className="text-sm">
              <input type="checkbox" checked={overrideParticipants.includes(user.id)} onChange={(event) =>
                setOverrideParticipants((current) => event.target.checked ? [...new Set([...current, user.id])] : current.filter((id) => id !== user.id))} /> {user.name}
            </label>)}
          </div></fieldset>
          <label className="block text-sm">예외 사유<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)}
            className="mt-1 min-h-24 w-full rounded border border-surface-300 p-2" placeholder="구체적인 업무상 예외 사유" /></label>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOverrideTargetId(null)}>취소</Button>
            <Button onClick={saveOverride} disabled={working || !overrideDate || !overrideResponsible || !overrideParticipants.length || !overrideReason.trim()}>예외 저장</Button></div>
        </div>
      </Modal>}
    </Card>
  );
}
