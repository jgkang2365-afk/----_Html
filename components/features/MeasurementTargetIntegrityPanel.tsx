"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import type { IntegrityIssue, IntegritySeverity } from "@/lib/measurement-target-integrity";

const severityClass: Record<IntegritySeverity, string> = {
  ERROR: "bg-rose-50 text-rose-800 border-rose-200",
  WARNING: "bg-amber-50 text-amber-800 border-amber-200",
  REVIEW: "bg-slate-100 text-slate-700 border-slate-200",
  NORMAL: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

export function MeasurementTargetIntegrityPanel({
  year,
  period,
  onBack,
}: { year: number; period: string; onBack: () => void }) {
  const [issues, setIssues] = useState<IntegrityIssue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [scope, setScope] = useState("abnormal");

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/businesses/integrity?year=${year}&period=${encodeURIComponent(period)}&t=${Date.now()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "점검 결과를 불러오지 못했습니다.");
      setIssues(body.issues || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "점검 결과를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  };

  const types = useMemo(() => Array.from(new Set((issues || []).map((issue) => issue.type))), [issues]);
  const visible = useMemo(() => (issues || []).filter((issue) => {
    const keyword = search.trim().toLowerCase();
    return (!keyword || `${issue.businessName} ${issue.code}`.toLowerCase().includes(keyword))
      && (type === "all" || issue.type === type)
      && (severity === "all" || issue.severity === severity)
      && (scope === "all" || issue.status !== "정상");
  }), [issues, search, type, severity, scope]);

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div><h2 className="text-lg font-bold text-slate-800">측정대상 정합성 점검</h2><p className="text-xs text-slate-500">읽기 전용 진단 · {year}년 {period} · K2B 실제결과는 별도 검증 상태로만 표시됩니다.</p></div>
      <div className="flex gap-2"><Button variant="secondary" onClick={onBack}>목록</Button><Button variant="primary" onClick={run} disabled={loading}>{loading ? "점검 중" : "점검 실행"}</Button></div>
    </div>
    {issues !== null && <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="사업장명 또는 코드" className="h-8 w-44 text-xs" />
        <Select value={type} onChange={(event) => setType(event.target.value)} options={[{ value: "all", label: "유형 전체" }, ...types.map((value) => ({ value, label: value }))]} className="h-8 w-44 text-xs" />
        <Select value={severity} onChange={(event) => setSeverity(event.target.value)} options={[{ value: "all", label: "심각도 전체" }, { value: "ERROR", label: "오류" }, { value: "WARNING", label: "주의" }, { value: "REVIEW", label: "확인필요" }, { value: "NORMAL", label: "정상" }]} className="h-8 w-28 text-xs" />
        <Select value={scope} onChange={(event) => setScope(event.target.value)} options={[{ value: "abnormal", label: "이상건" }, { value: "all", label: "전체" }]} className="h-8 w-24 text-xs" />
        <span className="ml-auto text-xs text-slate-500">{visible.length}건</span>
      </div>
      <div className="max-h-[calc(100vh-230px)] overflow-auto rounded-lg border border-slate-200 bg-white">
        <Table><TableHeader className="sticky top-0 z-10 bg-slate-50"><TableRow><TableHead>심각도</TableHead><TableHead>사업장</TableHead><TableHead>코드</TableHead><TableHead>점검유형</TableHead><TableHead>현재값</TableHead><TableHead>기준값</TableHead><TableHead>상태</TableHead></TableRow></TableHeader><TableBody>
          {visible.map((issue, index) => <TableRow key={`${issue.code}-${issue.type}-${index}`}><TableCell><span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${severityClass[issue.severity]}`}>{issue.severity === "ERROR" ? "오류" : issue.severity === "WARNING" ? "주의" : issue.severity === "NORMAL" ? "정상" : "확인"}</span></TableCell><TableCell title={issue.businessName} className="max-w-40 truncate">{issue.businessName}</TableCell><TableCell>{issue.code}</TableCell><TableCell>{issue.type}</TableCell><TableCell title={issue.currentValue} className="max-w-48 truncate">{issue.currentValue}</TableCell><TableCell title={issue.referenceValue} className="max-w-48 truncate">{issue.referenceValue}</TableCell><TableCell>{issue.status}</TableCell></TableRow>)}
          {visible.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">{scope === "abnormal" ? "이상 항목이 없습니다. 전체를 선택하면 정상 항목을 확인할 수 있습니다." : "현재 필터에 맞는 항목이 없습니다."}</TableCell></TableRow>}
        </TableBody></Table>
      </div>
    </>}
    {issues === null && !error && <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">자동 조회하지 않습니다. 점검 실행을 눌러 읽기 전용 결과를 확인하세요.</div>}
    {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
  </div>;
}
