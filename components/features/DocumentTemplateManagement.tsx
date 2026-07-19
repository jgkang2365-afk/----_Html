"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileSpreadsheet, FileText, Upload } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import {
  DOCUMENT_TYPE_META,
  DOCUMENT_TYPES,
  DocumentType,
} from "@/lib/document-generation/constants";

interface TemplateRow {
  id: string;
  document_type: DocumentType;
  measurement_year: number;
  measurement_period: "상반기" | "하반기";
  version: number;
  original_filename: string;
  is_active: boolean;
  size_bytes: number;
  created_at: string;
}

export function DocumentTemplateManagement() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    document_type: DOCUMENT_TYPES[0] as DocumentType,
    measurement_year: new Date().getFullYear(),
    measurement_period: "하반기" as "상반기" | "하반기",
    activate: true,
  });
  const [file, setFile] = useState<File | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/document-templates", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "템플릿 조회 실패");
      setTemplates(result.templates || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "템플릿 조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const grouped = useMemo(() => {
    const map = new Map<string, TemplateRow[]>();
    templates.forEach((template) => {
      const key = `${template.measurement_year}-${template.measurement_period}`;
      map.set(key, [...(map.get(key) || []), template]);
    });
    return Array.from(map.entries());
  }, [templates]);

  const uploadTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setMessage("등록할 템플릿 파일을 선택해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("document_type", form.document_type);
      body.append("measurement_year", String(form.measurement_year));
      body.append("measurement_period", form.measurement_period);
      body.append("activate", String(form.activate));
      const response = await fetch("/api/document-templates", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "템플릿 등록 실패");
      setMessage("템플릿을 등록했습니다.");
      setFile(null);
      const input = document.getElementById("document-template-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await fetchTemplates();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "템플릿 등록 실패");
    } finally {
      setSaving(false);
    }
  };

  const changeActive = async (template: TemplateRow, isActive: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/document-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, is_active: isActive }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "상태 변경 실패");
      setMessage(isActive ? "선택한 버전을 활성화했습니다." : "템플릿을 비활성화했습니다.");
      await fetchTemplates();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "상태 변경 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900">문서 템플릿 관리</h1>
          <p className="mt-1 text-sm text-slate-500">
            신규 사업장 문서에 사용할 연도·주기별 원본을 등록합니다.
          </p>
        </header>

        <section className="border-y border-slate-200 bg-white px-4 py-5 sm:px-6">
          <form
            onSubmit={uploadTemplate}
            className="grid gap-4 lg:grid-cols-[1.2fr_0.6fr_0.7fr_2fr_auto] lg:items-end"
          >
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">문서 종류</label>
              <Select
                value={form.document_type}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    document_type: event.target.value as DocumentType,
                  }))
                }
                options={DOCUMENT_TYPES.map((type) => ({
                  value: type,
                  label: DOCUMENT_TYPE_META[type].label,
                }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">적용 연도</label>
              <Input
                type="number"
                min="2000"
                max="2100"
                value={form.measurement_year}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    measurement_year: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">적용 주기</label>
              <Select
                value={form.measurement_period}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    measurement_period: event.target.value as "상반기" | "하반기",
                  }))
                }
                options={[
                  { value: "상반기", label: "상반기" },
                  { value: "하반기", label: "하반기" },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">원본 파일</label>
              <Input
                id="document-template-file"
                type="file"
                accept={DOCUMENT_TYPE_META[form.document_type].extension}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
            </div>
            <Button type="submit" disabled={saving} className="h-10 whitespace-nowrap">
              <Upload className="mr-1.5 h-4 w-4" />
              {saving ? "등록 중" : "등록"}
            </Button>
            <label className="flex items-center gap-2 text-sm text-slate-700 lg:col-span-5">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, activate: event.target.checked }))
                }
              />
              등록 후 이 버전을 활성 템플릿으로 사용
            </label>
          </form>
          {message && <p className="mt-3 text-sm font-medium text-blue-700">{message}</p>}
        </section>

        <section className="space-y-5">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500">템플릿을 불러오는 중입니다.</p>
          ) : grouped.length === 0 ? (
            <p className="border-y border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
              등록된 템플릿이 없습니다.
            </p>
          ) : (
            grouped.map(([group, rows]) => (
              <div key={group} className="bg-white">
                <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-800">
                  {group.replace("-", "년 ")}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-3">종류</th>
                        <th className="px-4 py-3">버전</th>
                        <th className="px-4 py-3">원본 파일명</th>
                        <th className="px-4 py-3">크기</th>
                        <th className="px-4 py-3">등록일</th>
                        <th className="px-4 py-3 text-right">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((template) => (
                        <tr key={template.id}>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2 font-medium text-slate-800">
                              {template.document_type === "MEASUREMENT_PLAN_XLSM" ? (
                                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <FileText className="h-4 w-4 text-blue-600" />
                              )}
                              {DOCUMENT_TYPE_META[template.document_type].label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600">v{template.version}</td>
                          <td
                            className="max-w-md truncate px-4 py-3 text-slate-600"
                            title={template.original_filename}
                          >
                            {template.original_filename}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {(template.size_bytes / 1024).toFixed(1)} KB
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {new Date(template.created_at).toLocaleString("ko-KR")}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {template.is_active ? (
                              <Button
                                variant="secondary"
                                disabled={saving}
                                onClick={() => changeActive(template, false)}
                              >
                                <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-600" />
                                활성
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                disabled={saving}
                                onClick={() => changeActive(template, true)}
                              >
                                활성화
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
