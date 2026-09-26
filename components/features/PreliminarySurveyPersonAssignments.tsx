"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Select } from "@/components/ui/Select";
import { currentDateInKst } from "@/lib/preliminary-survey-v2/recommendation-range";
import type { PersonAssignmentRole, PersonAssignmentRow } from "@/lib/preliminary-survey-v2/person-assignment-view";

interface Filters {
  startDate: string;
  endDate: string;
  employeeId: string;
  role: PersonAssignmentRole | "";
  search: string;
}

function defaultFilters(): Filters {
  const today = currentDateInKst();
  return { startDate: today, endDate: today, employeeId: "", role: "", search: "" };
}

export function PreliminarySurveyPersonAssignments() {
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [query, setQuery] = useState<Filters>(defaultFilters);
  const [rows, setRows] = useState<PersonAssignmentRow[]>([]);
  const [users, setUsers] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate: query.startDate, endDate: query.endDate });
      if (query.employeeId) params.set("employeeId", query.employeeId);
      if (query.role) params.set("role", query.role);
      if (query.search.trim()) params.set("search", query.search.trim());
      const response = await fetch(`/api/preliminary-survey-v2/person-assignments?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "개인별 배정 현황 조회 실패");
      setRows(result.rows ?? []);
      setUsers(result.users ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "개인별 배정 현황 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);
  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.name.localeCompare(b.name, "ko")), [users]);
  const search = () => setQuery({ ...draft });
  const reset = () => {
    const defaults = defaultFilters();
    setDraft(defaults);
    setQuery(defaults);
  };

  return <div className="space-y-3">
    <Card className="grid gap-2 p-3 sm:grid-cols-2 min-[1280px]:grid-cols-[minmax(21rem,22rem)_10rem_10rem_minmax(12rem,1fr)_auto] min-[1280px]:items-end">
      <fieldset className="min-w-0 space-y-1">
        <legend className="text-sm font-medium text-text-700">조회 기간</legend>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
          <Input type="date" aria-label="조회 기간 시작일" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} className="h-10 px-2 text-sm" />
          <span className="pb-2 text-sm text-text-500" aria-hidden="true">~</span>
          <Input type="date" aria-label="조회 기간 종료일" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} className="h-10 px-2 text-sm" />
        </div>
      </fieldset>
      <Select label="직원" aria-label="직원" value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })} options={[{ value: "", label: "전체" }, ...sortedUsers.map((user) => ({ value: String(user.id), label: user.name }))]} className="h-10 py-0 text-sm" />
      <Select label="역할" aria-label="역할" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Filters["role"] })} options={[{ value: "", label: "전체" }, { value: "measurement_assignee", label: "측정 담당자" }, { value: "preliminary_surveyor", label: "예비조사자" }]} className="h-10 py-0 text-sm" />
      <Input label="코드 · 사업장명" aria-label="코드 또는 사업장명" value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }} className="h-10 text-sm" placeholder="부분 검색" />
      <div className="flex items-end gap-1 sm:col-span-2 min-[1280px]:col-span-1"><Button size="sm" className="h-10 px-3" onClick={search}>검색</Button><Button size="sm" variant="secondary" className="h-10 px-3" onClick={reset}>초기화</Button></div>
    </Card>
    {error && <Alert variant="error">{error}</Alert>}
    <Card className="p-0">
      {loading ? <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div> : <div className="max-h-[calc(100vh-250px)] overflow-auto">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-20 bg-surface-50 text-left text-text-700 shadow-sm"><tr>{[
            ["직원", "w-[9%]"], ["역할", "w-[11%]"], ["코드 · 사업장명", "w-[25%]"], ["시·군·구", "w-[11%]"], ["읍·면·동", "w-[11%]"], ["측정일", "w-[15%]"], ["예비조사일", "w-[10%]"], ["방식", "w-[8%]"],
          ].map(([label, width]) => <th key={label} className={`${width} px-2 py-2 font-semibold`}>{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-surface-200">{rows.map((row) => <tr key={row.key} className="hover:bg-primary-50/40">
            <td className="truncate px-2 py-2" title={row.employeeName}>{row.employeeName}</td>
            <td className="px-2 py-2">{row.role === "measurement_assignee" ? "측정 담당자" : "예비조사자"}</td>
            <td className="px-2 py-2"><div className="font-medium text-text-900">{row.code}</div><div className="truncate" title={row.businessName}>{row.businessName}</div></td>
            <td className="truncate px-2 py-2" title={row.sigungu}>{row.sigungu}</td><td className="truncate px-2 py-2" title={row.eupMyeonDong}>{row.eupMyeonDong}</td>
            <td className="truncate px-2 py-2" title={row.measurementDates.join(" · ")}>{row.measurementDates.join(" · ") || "-"}</td><td className="px-2 py-2">{row.preliminaryDate || "-"}</td>
            <td className="px-2 py-2">{row.method === "field" ? "방문" : row.method === "phone" ? "유선" : "-"}</td>
          </tr>)}</tbody>
        </table>
        {rows.length === 0 && <div className="p-10 text-center text-text-500">조건에 맞는 개인별 배정 내역이 없습니다.</div>}
      </div>}
    </Card>
  </div>;
}
