"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

interface ResultRow {
  officeCode: string;
  officeName: string;
  jurisdictionReference: string;
  phone: string;
  fax: string;
}

export function LaborOfficeLookup() {
  const [draft, setDraft] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [status, setStatus] = useState<"matched" | "ambiguous" | "unmatched" | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const query = draft.trim();
    setActiveQuery(query);
    if (!query) { setRows([]); setStatus(null); return; }
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/preliminary-survey-v2/labor-offices?query=${encodeURIComponent(query)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "노동관서 조회 실패");
      setRows(result.results ?? []); setStatus(result.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "노동관서 조회 실패");
    } finally { setLoading(false); }
  };
  const reset = () => { setDraft(""); setActiveQuery(""); setRows([]); setStatus(null); setError(null); };

  return <div className="space-y-3">
    <Card className="p-3"><div className="flex items-end gap-2">
      <label className="min-w-[320px] flex-1 text-xs font-medium text-text-700">행정구역 또는 도로명 주소<input aria-label="행정구역 또는 도로명 주소" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} className="mt-1 h-9 w-full rounded-md border border-surface-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" placeholder="예: 아산, 아산시, 충남 아산시, 전체 주소" /></label>
      <Button className="h-9 px-3 text-xs" onClick={() => void search()} disabled={loading}>검색</Button><Button variant="secondary" className="h-9 px-3 text-xs" onClick={reset} disabled={loading}>초기화</Button>
    </div></Card>
    {error && <Alert variant="error">{error}</Alert>}
    {status === "ambiguous" && <Alert variant="warning">입력만으로 담당 노동관서를 확정할 수 없습니다. 시·군·구를 더 구체적으로 입력해 주세요. 아래 목록은 저장된 기준과 일치하는 후보입니다.</Alert>}
    <Card className="p-0">{loading ? <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div> : <div className="max-h-[calc(100vh-250px)] overflow-auto">
      <table className="w-full table-fixed text-sm"><thead className="sticky top-0 z-20 bg-surface-50 text-left text-text-700 shadow-sm"><tr><th className="w-[30%] px-3 py-2 font-semibold">담당 노동관서</th><th className="w-[40%] px-3 py-2 font-semibold">관할 기준</th><th className="w-[15%] px-3 py-2 font-semibold">전화</th><th className="w-[15%] px-3 py-2 font-semibold">팩스</th></tr></thead>
      <tbody className="divide-y divide-surface-200">{rows.map((row) => <tr key={row.officeCode} className="hover:bg-primary-50/40"><td className="truncate px-3 py-2 font-medium text-text-900" title={row.officeName}>{row.officeName}</td><td className="truncate px-3 py-2" title={row.jurisdictionReference}>{row.jurisdictionReference}</td><td className="px-3 py-2">{row.phone}</td><td className="px-3 py-2">{row.fax}</td></tr>)}</tbody></table>
      {activeQuery && status === "unmatched" && <div className="p-10 text-center text-text-500">일치하는 노동관서를 찾지 못했습니다. 행정구역을 더 구체적으로 입력해 주세요.</div>}
      {!activeQuery && <div className="p-10 text-center text-text-500">행정구역 또는 저장된 주소를 입력해 조회하세요.</div>}
    </div>}</Card>
  </div>;
}
