"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  ListPlus,
  Pencil,
  Settings2,
  Upload,
} from "lucide-react";
import { Button, Input, Modal, Select } from "@/components/ui";
import {
  ANNUAL_TEMPLATE_PERIOD,
  templateMeasurementPeriodLabel,
} from "@/lib/document-generation/constants";

type FileFormat = "HWPX" | "XLSX" | "XLSM";
type Period = "상반기" | "하반기" | typeof ANNUAL_TEMPLATE_PERIOD;
type Definition = {
  id: string;
  code: string;
  name: string;
  file_format: FileFormat;
  filename_pattern: string;
  default_selected: boolean;
  sort_order: number;
  is_active: boolean;
  mapping_count?: number;
  mappings_count?: number;
  template_count?: number;
};
type Mapping = {
  id?: string;
  source_field: string;
  target_type: "HWPX_FIELD" | "EXCEL_CELL";
  target_sheet?: string | null;
  target_address: string;
  required: boolean;
  default_value?: string | null;
  sort_order: number;
  display_name?: string;
  match_type?: "exact" | "alias" | "manual" | null;
  occurrence_count?: number;
  sections?: number[];
  warnings?: string[];
  present_in_file?: boolean;
};
type AnalysisPlaceholder = {
  placeholder_name: string;
  display_name: string;
  mapped_db_field: string | null;
  required: boolean;
  default_value: string;
  match_type: "exact" | "alias" | null;
  occurrence_count: number;
  sections: number[];
  warnings: string[];
};
type AnalysisSummary = {
  discovered: number;
  unique: number;
  auto_matched: number;
  unmatched: number;
  requires_confirmation: number;
  duplicate_names: number;
  warnings: number;
};
type Field = { value?: string; code?: string; name?: string; label?: string };
type Template = {
  id: string;
  document_definition_id?: string;
  measurement_year: number;
  measurement_period: Period;
  version: number;
  original_filename: string;
  size_bytes: number;
  created_at: string;
  is_active: boolean;
};

const emptyDefinition = (): Omit<Definition, "id" | "code"> => ({
  name: "",
  file_format: "HWPX",
  filename_pattern: "{business_name}({document_name}-{short_year}{short_period})",
  default_selected: true,
  sort_order: 0,
  is_active: true,
});
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const responseRows = <T,>(value: unknown, keys: string[]): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object")
    for (const key of keys) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate as T[];
    }
  return [];
};
const extension = (format: FileFormat) =>
  format === "HWPX" ? ".hwpx" : format === "XLSX" ? ".xlsx" : ".xlsm";
const fileKey = (value: File) => `${value.name}:${value.size}:${value.lastModified}`;

export function DocumentTemplateManagement() {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [definitionModal, setDefinitionModal] = useState(false);
  const [editing, setEditing] = useState<Definition | null>(null);
  const [definitionForm, setDefinitionForm] = useState(emptyDefinition());
  const [mappingModal, setMappingModal] = useState(false);
  const [mappingMode, setMappingMode] = useState<"manual" | "analysis">("manual");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary | null>(null);
  const [confirmedAnalysisFile, setConfirmedAnalysisFile] = useState("");
  const analysisRequest = useRef(0);
  const [templateForm, setTemplateForm] = useState({
    measurement_year: new Date().getFullYear(),
    measurement_period: "상반기" as Period,
    activate: true,
  });
  const [file, setFile] = useState<File | null>(null);
  const selected = definitions.find((definition) => definition.id === selectedId) || null;
  const notify = (text: string) => setMessage(text);
  const request = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...options });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "요청 처리에 실패했습니다.");
    return result;
  };
  const loadDefinitions = useCallback(async () => {
    const result = await request("/api/document-definitions");
    const rows = responseRows<Definition>(result, ["definitions", "document_definitions", "data"]);
    setDefinitions(
      rows.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"))
    );
    setFields(responseRows<Field>(result, ["source_fields"]));
    setSelectedId((current) =>
      current && rows.some((row) => row.id === current) ? current : rows[0]?.id || ""
    );
  }, []);
  const loadTemplates = useCallback(async (definitionId: string) => {
    if (!definitionId) return setTemplates([]);
    const result = await request(
      `/api/document-templates?document_definition_id=${encodeURIComponent(definitionId)}`
    );
    setTemplates(responseRows<Template>(result, ["templates", "data"]));
  }, []);
  useEffect(() => {
    void loadDefinitions()
      .catch((error) =>
        notify(error instanceof Error ? error.message : "문서 설정을 불러오지 못했습니다.")
      )
      .finally(() => setLoading(false));
  }, [loadDefinitions]);
  useEffect(() => {
    void loadTemplates(selectedId).catch((error) =>
      notify(error instanceof Error ? error.message : "템플릿을 불러오지 못했습니다.")
    );
  }, [selectedId, loadTemplates]);
  const openDefinition = (definition?: Definition) => {
    setEditing(definition || null);
    setDefinitionForm(
      definition
        ? {
            name: definition.name,
            file_format: definition.file_format,
            filename_pattern: definition.filename_pattern,
            default_selected: definition.default_selected,
            sort_order: definition.sort_order,
            is_active: definition.is_active,
          }
        : emptyDefinition()
    );
    setDefinitionModal(true);
  };
  const saveDefinition = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await request("/api/document-definitions", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...definitionForm, id: editing.id } : definitionForm),
      });
      await loadDefinitions();
      setDefinitionModal(false);
      const created = !editing ? (result.definition as Definition | undefined) : undefined;
      if (created?.id) {
        setSelectedId(created.id);
        await openMappings(created);
        notify("문서 종류를 추가했습니다. 이어서 입력 설정을 완료해 주세요.");
      } else {
        notify(editing ? "문서 종류를 수정했습니다." : "문서 종류를 추가했습니다.");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const toggleDefinition = async (definition: Definition) => {
    setSaving(true);
    try {
      await request("/api/document-definitions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: definition.id, is_active: !definition.is_active }),
      });
      await loadDefinitions();
      notify(
        definition.is_active ? "문서 종류를 사용 중지했습니다." : "문서 종류를 재활성화했습니다."
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "상태 변경에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const openMappings = async (definition: Definition) => {
    setSelectedId(definition.id);
    setMappingMode("manual");
    setAnalysisSummary(null);
    setMappingModal(true);
    try {
      const result = await request(`/api/document-definitions/${definition.id}/mappings`);
      setMappings(
        responseRows<Mapping>(result, ["mappings", "data"]).map((mapping, index) => ({
          ...mapping,
          target_type:
            mapping.target_type ||
            (definition.file_format === "HWPX" ? "HWPX_FIELD" : "EXCEL_CELL"),
          sort_order: mapping.sort_order ?? index,
        }))
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "입력 설정을 불러오지 못했습니다.");
      setMappings([]);
    }
  };
  const analyzeHwpxFile = async (selectedFile: File) => {
    if (!selected || selected.file_format !== "HWPX") return;
    if (!selectedFile.name.toLowerCase().endsWith(".hwpx")) {
      setFile(null);
      return notify("HWPX 형식 파일만 등록할 수 있습니다.");
    }
    const requestId = analysisRequest.current + 1;
    analysisRequest.current = requestId;
    setAnalyzing(true);
    setConfirmedAnalysisFile("");
    setAnalysisSummary(null);
    try {
      const body = new FormData();
      body.set("document_definition_id", selected.id);
      body.set("file", selectedFile);
      const [analysisResult, mappingResult] = await Promise.all([
        request("/api/document-templates/analyze", { method: "POST", body }),
        request(`/api/document-definitions/${selected.id}/mappings`),
      ]);
      if (requestId !== analysisRequest.current) return;
      const placeholders = responseRows<AnalysisPlaceholder>(analysisResult, ["placeholders"]);
      const existingMappings = responseRows<Mapping>(mappingResult, ["mappings", "data"]);
      const existingByPlaceholder = new Map(
        existingMappings.map((mapping) => [mapping.target_address, mapping])
      );
      const analyzedMappings: Mapping[] = placeholders.map((placeholder, index) => {
        const existing = existingByPlaceholder.get(placeholder.placeholder_name);
        const suggestedField = placeholder.mapped_db_field || "";
        const existingKeepsAutomaticMatch =
          Boolean(existing) && Boolean(suggestedField) && existing?.source_field === suggestedField;
        return {
          id: existing?.id,
          source_field: existing?.source_field || suggestedField,
          target_type: "HWPX_FIELD",
          target_sheet: null,
          target_address: placeholder.placeholder_name,
          required: existing?.required ?? placeholder.required,
          default_value: existing?.default_value ?? placeholder.default_value,
          sort_order: index,
          display_name: placeholder.display_name,
          match_type: existing
            ? existingKeepsAutomaticMatch
              ? placeholder.match_type
              : "manual"
            : placeholder.match_type,
          occurrence_count: placeholder.occurrence_count,
          sections: placeholder.sections,
          warnings: placeholder.warnings,
          present_in_file: true,
        };
      });
      const analyzedNames = new Set(placeholders.map(({ placeholder_name }) => placeholder_name));
      for (const existing of existingMappings) {
        if (analyzedNames.has(existing.target_address)) continue;
        analyzedMappings.push({
          ...existing,
          sort_order: analyzedMappings.length,
          display_name: "",
          match_type: "manual",
          occurrence_count: 0,
          sections: [],
          warnings: ["기존 매핑 누름틀이 선택한 HWPX에서 발견되지 않았습니다."],
          present_in_file: false,
        });
      }
      const summary = analysisResult.summary as AnalysisSummary;
      setMappings(analyzedMappings);
      setAnalysisSummary(summary);
      setMappingMode("analysis");
      setMappingModal(true);
      notify(
        `누름틀 ${summary.discovered}개 발견 / 자동매칭 ${summary.auto_matched}개 / 확인 필요 ${summary.requires_confirmation}개`
      );
    } catch (error) {
      if (requestId !== analysisRequest.current) return;
      setFile(null);
      notify(error instanceof Error ? error.message : "HWPX 누름틀 분석에 실패했습니다.");
    } finally {
      if (requestId === analysisRequest.current) setAnalyzing(false);
    }
  };
  const changeTemplateFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    analysisRequest.current += 1;
    setAnalyzing(false);
    setFile(selectedFile);
    setConfirmedAnalysisFile("");
    if (selectedFile && selected?.file_format === "HWPX") void analyzeHwpxFile(selectedFile);
  };
  const saveMappings = async () => {
    if (!selected) return;
    if (mappingMode === "analysis") {
      const unnamed = mappings.filter(
        (mapping) => mapping.present_in_file !== false && !mapping.target_address
      );
      const unmatched = mappings.filter(
        (mapping) =>
          mapping.present_in_file !== false && (!mapping.target_address || !mapping.source_field)
      );
      const stale = mappings.filter((mapping) => mapping.present_in_file === false);
      if (unnamed.length > 0)
        return notify("내부 이름이 없는 누름틀이 있습니다. HWPX에서 누름틀 이름을 지정해 주세요.");
      if (unmatched.length > 0)
        return notify("미매칭 누름틀의 DB 필드를 모두 선택한 뒤 확인해 주세요.");
      if (stale.length > 0)
        return notify("새 HWPX에 없는 기존 매핑을 확인하고 필요하면 삭제해 주세요.");
    }
    setSaving(true);
    try {
      await request(`/api/document-definitions/${selected.id}/mappings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappings: mappings.map((mapping, index) => ({
            source_field: mapping.source_field,
            target_address: mapping.target_address,
            required: mapping.required,
            default_value: mapping.default_value ?? null,
            sort_order: index,
            target_type: selected.file_format === "HWPX" ? "HWPX_FIELD" : "EXCEL_CELL",
            target_sheet: selected.file_format === "HWPX" ? null : mapping.target_sheet || "",
          })),
        }),
      });
      setMappingModal(false);
      await loadDefinitions();
      if (mappingMode === "analysis" && file) {
        setConfirmedAnalysisFile(fileKey(file));
        notify("자동 분석 매핑을 저장했습니다. 원본 등록 버튼을 눌러 최종 등록해 주세요.");
      } else notify("입력 매핑을 저장했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "입력 매핑 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const uploadTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !file) return notify("등록할 문서 종류와 원본 파일을 선택해 주세요.");
    if (!file.name.toLowerCase().endsWith(extension(selected.file_format)))
      return notify(`${selected.file_format} 형식 파일만 등록할 수 있습니다.`);
    if (selected.file_format === "HWPX" && confirmedAnalysisFile !== fileKey(file)) {
      void analyzeHwpxFile(file);
      return notify("HWPX 누름틀 자동 분석 결과를 먼저 확인해 주세요.");
    }
    setSaving(true);
    try {
      const body = new FormData();
      body.set("document_definition_id", selected.id);
      body.set("measurement_year", String(templateForm.measurement_year));
      body.set("measurement_period", templateForm.measurement_period);
      body.set("activate", String(templateForm.activate));
      body.set("file", file);
      await request("/api/document-templates", { method: "POST", body });
      await loadTemplates(selected.id);
      setFile(null);
      setConfirmedAnalysisFile("");
      setAnalysisSummary(null);
      notify("템플릿을 등록했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "템플릿 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const changeActive = async (template: Template, isActive: boolean) => {
    setSaving(true);
    try {
      await request("/api/document-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, is_active: isActive }),
      });
      if (selected) await loadTemplates(selected.id);
      notify(isActive ? "선택한 버전을 활성화했습니다." : "템플릿을 비활성화했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "상태 변경에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const fieldOptions = useMemo(
    () =>
      fields
        .map((field) => ({
          value: field.value || field.code || "",
          label: field.label || field.name || field.code || "",
        }))
        .filter((option) => option.value),
    [fields]
  );
  if (loading)
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-center text-sm text-slate-500">
        문서 설정을 불러오는 중입니다.
      </main>
    );
  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1480px] space-y-4">
        <header className="pb-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">문서 템플릿 관리</h1>
          <p className="mt-1 text-sm text-slate-500">
            문서 종류, 입력 위치와 연도·주기별 원본 양식을 관리합니다.
          </p>
          <p className="mt-2 text-sm font-medium text-blue-700">
            1 문서 종류 → 2 입력 설정 → 3 원본 등록
          </p>
        </header>
        {message && (
          <p className="border-y border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {message}
          </p>
        )}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-bold text-slate-800">문서 종류 관리</h2>
              <p className="mt-1 text-xs text-slate-500">
                사용 중지된 종류는 신규 문서 생성 목록에 표시되지 않습니다.
              </p>
            </div>
            <Button
              size="sm"
              className="w-full whitespace-nowrap px-4 sm:w-auto"
              onClick={() => openDefinition()}
            >
              <ListPlus className="mr-1.5 h-4 w-4" />
              문서 종류 추가
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px] table-fixed text-sm">
              <colgroup>
                <col className="w-[230px]" />
                <col className="w-[76px]" />
                <col />
                <col className="w-[100px]" />
                <col className="w-[64px]" />
                <col className="w-[88px]" />
                <col className="w-[88px]" />
                <col className="w-[300px]" />
              </colgroup>
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3">문서 종류</th>
                  <th className="px-4 py-3">형식</th>
                  <th className="px-4 py-3">출력 파일명 규칙</th>
                  <th className="px-4 py-3">기본 선택</th>
                  <th className="px-4 py-3">순서</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">입력 매핑</th>
                  <th className="px-4 py-3 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {definitions.map((definition) => (
                  <tr
                    key={definition.id}
                    className={
                      !definition.is_active
                        ? "bg-slate-50 text-slate-400"
                        : "transition-colors hover:bg-slate-50/70"
                    }
                  >
                    <td className="px-4 py-3.5 font-medium text-slate-800">
                      <span className="block truncate" title={definition.name}>
                        {definition.name}
                      </span>
                      <p
                        className="mt-1 truncate font-mono text-[11px] font-normal text-slate-400"
                        title={definition.code}
                      >
                        {definition.code}
                      </p>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {definition.file_format}
                      </span>
                    </td>
                    <td className="px-4 py-3.5" title={definition.filename_pattern}>
                      <code className="block truncate text-xs text-slate-600">
                        {definition.filename_pattern}
                      </code>
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                          definition.default_selected
                            ? "bg-blue-50 text-blue-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {definition.default_selected ? "기본 선택" : "선택 안 함"}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-center tabular-nums">
                      {definition.sort_order}
                    </td>
                    <td className="px-3 py-3.5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                          definition.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {definition.is_active ? "사용 중" : "사용 중지"}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-center tabular-nums">
                      {definition.mapping_count ?? definition.mappings_count ?? 0}개
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 whitespace-nowrap px-3 text-xs"
                          disabled={saving}
                          onClick={() => openDefinition(definition)}
                        >
                          <Pencil className="mr-1 h-4 w-4" />
                          수정
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 whitespace-nowrap px-3 text-xs"
                          disabled={saving}
                          onClick={() => void openMappings(definition)}
                        >
                          <Settings2 className="mr-1 h-4 w-4" />
                          입력 설정
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 whitespace-nowrap px-3 text-xs"
                          disabled={saving}
                          onClick={() => void toggleDefinition(definition)}
                        >
                          {definition.is_active ? "사용 중지" : "재활성화"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {definitions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      등록된 문서 종류가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-bold text-slate-800">템플릿 파일 관리</h2>
              <p className="mt-1 text-xs text-slate-500">
                문서 종류를 선택한 뒤 적용 연도와 주기별 원본을 등록합니다.
              </p>
            </div>
            <div className="w-full md:w-[420px]">
              <Select
                value={selectedId}
                onChange={(event) => {
                  analysisRequest.current += 1;
                  setAnalyzing(false);
                  setSelectedId(event.target.value);
                  setFile(null);
                  setConfirmedAnalysisFile("");
                  setAnalysisSummary(null);
                }}
                options={[
                  { value: "", label: "문서 종류 선택" },
                  ...definitions.map((definition) => ({
                    value: definition.id,
                    label: `${definition.name} (${definition.file_format})`,
                  })),
                ]}
              />
            </div>
          </div>
          {selected ? (
            <>
              {selected.file_format === "HWPX" && (
                <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
                  <span>
                    HWPX 파일을 선택하면 누름틀을 자동 분석합니다. 결과를 확인한 뒤 등록할 수
                    있습니다.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 whitespace-nowrap px-3 text-xs"
                    disabled={saving}
                    onClick={() => void openMappings(selected)}
                  >
                    수동 입력 설정
                  </Button>
                </div>
              )}
              <form
                onSubmit={uploadTemplate}
                className="grid gap-4 border-b border-slate-200 bg-slate-50/40 p-5 md:grid-cols-2 xl:grid-cols-[180px_220px_minmax(360px,1fr)_auto] xl:items-end"
              >
                <div>
                  <label className="mb-1 block text-sm font-medium">적용 연도</label>
                  <Input
                    type="number"
                    min="2000"
                    max="2100"
                    value={templateForm.measurement_year}
                    onChange={(event) =>
                      setTemplateForm((previous) => ({
                        ...previous,
                        measurement_year: Number(event.target.value),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">적용 주기</label>
                  <Select
                    value={templateForm.measurement_period}
                    onChange={(event) =>
                      setTemplateForm((previous) => ({
                        ...previous,
                        measurement_period: event.target.value as Period,
                      }))
                    }
                    options={[
                      { value: "상반기", label: "상반기" },
                      { value: "하반기", label: "하반기" },
                      { value: ANNUAL_TEMPLATE_PERIOD, label: "연간 공통" },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    원본 파일 ({extension(selected.file_format)})
                  </label>
                  <Input
                    type="file"
                    accept={extension(selected.file_format)}
                    onChange={changeTemplateFile}
                  />
                  {selected.file_format === "HWPX" && analyzing && (
                    <p className="mt-1 text-xs font-medium text-blue-700">누름틀 자동 분석 중…</p>
                  )}
                  {selected.file_format === "HWPX" &&
                    file &&
                    confirmedAnalysisFile === fileKey(file) &&
                    analysisSummary && (
                      <p className="mt-1 text-xs font-medium text-emerald-700">
                        분석 확인 완료: 누름틀 {analysisSummary.discovered}개 / 자동매칭{" "}
                        {analysisSummary.auto_matched}개
                      </p>
                    )}
                </div>
                <Button
                  type="submit"
                  size="sm"
                  className="h-10 whitespace-nowrap px-5"
                  disabled={
                    saving ||
                    analyzing ||
                    !selected.is_active ||
                    (selected.file_format === "HWPX" &&
                      (!file || confirmedAnalysisFile !== fileKey(file)))
                  }
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  {analyzing ? "분석 중" : saving ? "등록 중" : "등록"}
                </Button>
                <label className="flex items-center gap-2 text-sm md:col-span-2 xl:col-span-4">
                  <input
                    type="checkbox"
                    checked={templateForm.activate}
                    onChange={(event) =>
                      setTemplateForm((previous) => ({
                        ...previous,
                        activate: event.target.checked,
                      }))
                    }
                  />
                  이 연도·주기의 기본 양식으로 지정
                </label>
                {!selected.is_active && (
                  <p className="text-sm text-amber-700 md:col-span-2 xl:col-span-4">
                    사용 중지된 문서 종류에는 새 템플릿을 등록할 수 없습니다.
                  </p>
                )}
              </form>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-[190px]" />
                    <col className="w-[80px]" />
                    <col />
                    <col className="w-[110px]" />
                    <col className="w-[190px]" />
                    <col className="w-[120px]" />
                  </colgroup>
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3">적용 연도·주기</th>
                      <th className="px-4 py-3">버전</th>
                      <th className="px-4 py-3">원본 파일명</th>
                      <th className="px-4 py-3">크기</th>
                      <th className="px-4 py-3">등록일</th>
                      <th className="px-4 py-3 text-right">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {templates.map((template) => (
                      <tr key={template.id}>
                        <td className="px-4 py-3">
                          {template.measurement_year}년{" "}
                          {templateMeasurementPeriodLabel(template.measurement_period)}
                        </td>
                        <td className="px-4 py-3">v{template.version}</td>
                        <td className="truncate px-4 py-3" title={template.original_filename}>
                          {template.original_filename}
                        </td>
                        <td className="px-4 py-3">{(template.size_bytes / 1024).toFixed(1)} KB</td>
                        <td className="px-4 py-3">
                          {new Date(template.created_at).toLocaleString("ko-KR")}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 whitespace-nowrap px-3 text-xs"
                            disabled={saving}
                            onClick={() => void changeActive(template, !template.is_active)}
                          >
                            {template.is_active ? (
                              <>
                                <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-600" />
                                활성
                              </>
                            ) : (
                              "활성화"
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {templates.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          등록된 템플릿이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="p-8 text-center text-sm text-slate-500">
              관리할 문서 종류를 선택해 주세요.
            </p>
          )}
        </section>
      </div>
      <Modal
        isOpen={definitionModal}
        onClose={() => setDefinitionModal(false)}
        title={editing ? "문서 종류 수정" : "문서 종류 추가"}
        size="md"
      >
        <form onSubmit={saveDefinition} className="space-y-4 p-1 pt-5">
          {!editing && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              실제 원본 파일은 문서 종류를 저장한 뒤 아래의 템플릿 파일 관리에서 등록합니다.
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">문서 종류명</label>
            <Input
              required
              value={definitionForm.name}
              onChange={(event) =>
                setDefinitionForm((previous) => ({ ...previous, name: event.target.value }))
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">파일 형식</label>
            <Select
              disabled={Boolean(editing && (editing.template_count || templates.length))}
              value={definitionForm.file_format}
              onChange={(event) =>
                setDefinitionForm((previous) => ({
                  ...previous,
                  file_format: event.target.value as FileFormat,
                }))
              }
              options={[
                { value: "HWPX", label: "HWPX" },
                { value: "XLSX", label: "XLSX" },
                { value: "XLSM", label: "XLSM" },
              ]}
            />
            {editing && (editing.template_count || templates.length) ? (
              <p className="mt-1 text-xs text-slate-500">
                템플릿이 등록된 문서의 형식은 변경할 수 없습니다.
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">출력 파일명 규칙</label>
            <Input
              required
              value={definitionForm.filename_pattern}
              onChange={(event) =>
                setDefinitionForm((previous) => ({
                  ...previous,
                  filename_pattern: event.target.value,
                }))
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              확장자는 자동 추가됩니다. {"{business_name}"}, {"{year}"}, {"{short_period}"},{" "}
              {"{document_name}"} 등을 사용할 수 있습니다.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">표시 순서</label>
            <Input
              type="number"
              value={definitionForm.sort_order}
              onChange={(event) =>
                setDefinitionForm((previous) => ({
                  ...previous,
                  sort_order: Number(event.target.value),
                }))
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={definitionForm.default_selected}
              onChange={(event) =>
                setDefinitionForm((previous) => ({
                  ...previous,
                  default_selected: event.target.checked,
                }))
              }
            />
            신규 문서 생성창에서 기본 선택
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={definitionForm.is_active}
              onChange={(event) =>
                setDefinitionForm((previous) => ({ ...previous, is_active: event.target.checked }))
              }
            />
            사용 중
          </label>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setDefinitionModal(false)}>
              취소
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "저장 중" : "저장"}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={mappingModal}
        onClose={() => setMappingModal(false)}
        title={`${selected?.name || "문서"} 입력 설정`}
        size="xl"
      >
        <div className="space-y-4 p-1 pt-5">
          <p className="text-sm text-slate-600">
            {selected?.file_format === "HWPX"
              ? mappingMode === "analysis"
                ? "자동 매칭 결과를 확인하고 미매칭 항목의 DB 필드만 선택해 주세요. 중복 누름틀은 하나의 DB 값을 모든 출현 위치에 입력합니다."
                : "DB 필드와 한글 누름틀 이름을 연결합니다. 수동 매핑 추가 기능은 예외 처리용으로 계속 사용할 수 있습니다."
              : "DB 필드와 Excel 시트·셀 주소를 연결합니다."}
          </p>
          {selected?.file_format === "HWPX" && mappingMode === "analysis" && analysisSummary && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p className="font-semibold">
                누름틀 {analysisSummary.discovered}개 발견 / 자동매칭 {analysisSummary.auto_matched}
                개 / 확인 필요 {analysisSummary.requires_confirmation}개
              </p>
              {analysisSummary.auto_matched === 0 && (
                <p className="mt-1 text-amber-700">
                  매칭 가능한 DB 필드가 없습니다. 각 누름틀의 DB 필드를 직접 선택해 주세요.
                </p>
              )}
            </div>
          )}
          <div className="max-h-[55vh] overflow-auto border-y border-slate-200">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  {selected?.file_format === "HWPX" ? (
                    <>
                      <th className="p-2">누름틀 이름</th>
                      <th className="p-2">표시 이름</th>
                      <th className="p-2">자동 매칭된 DB 필드</th>
                    </>
                  ) : (
                    <>
                      <th className="p-2">DB 필드</th>
                      <th className="p-2">시트명</th>
                      <th className="p-2">셀 주소</th>
                    </>
                  )}
                  <th className="p-2">필수</th>
                  <th className="p-2">기본값</th>
                  {selected?.file_format === "HWPX" && <th className="p-2">상태</th>}
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping, index) => {
                  const update = (changes: Partial<Mapping>) =>
                    setMappings((rows) =>
                      rows.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, ...changes } : row
                      )
                    );
                  return (
                    <tr
                      key={`${mapping.id || "new"}-${index}`}
                      className={mapping.present_in_file === false ? "bg-amber-50" : ""}
                    >
                      {selected?.file_format === "HWPX" ? (
                        <>
                          <td className="min-w-[190px] p-2 align-top">
                            <Input
                              value={mapping.target_address}
                              placeholder="누름틀 이름"
                              disabled={
                                mappingMode === "analysis" && mapping.present_in_file !== false
                              }
                              onChange={(event) => update({ target_address: event.target.value })}
                            />
                            {mapping.occurrence_count ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {mapping.occurrence_count}회 · section{" "}
                                {(mapping.sections || []).join(", ")}
                              </p>
                            ) : null}
                          </td>
                          <td className="min-w-[150px] p-2 align-top text-slate-700">
                            {mapping.display_name || "—"}
                          </td>
                          <td className="min-w-[210px] p-2 align-top">
                            <Select
                              value={mapping.source_field}
                              onChange={(event) =>
                                update({
                                  source_field: event.target.value,
                                  match_type: event.target.value ? "manual" : null,
                                })
                              }
                              options={[{ value: "", label: "필드 선택" }, ...fieldOptions]}
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-2">
                            <Select
                              value={mapping.source_field}
                              onChange={(event) => update({ source_field: event.target.value })}
                              options={[{ value: "", label: "필드 선택" }, ...fieldOptions]}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              value={mapping.target_sheet || ""}
                              placeholder="시트명"
                              onChange={(event) => update({ target_sheet: event.target.value })}
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              value={mapping.target_address}
                              placeholder="A1"
                              onChange={(event) => update({ target_address: event.target.value })}
                            />
                          </td>
                        </>
                      )}
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={mapping.required}
                          onChange={(event) => update({ required: event.target.checked })}
                        />
                      </td>
                      <td className="min-w-[160px] p-2 align-top">
                        <Input
                          value={mapping.default_value || ""}
                          onChange={(event) => update({ default_value: event.target.value })}
                        />
                      </td>
                      {selected?.file_format === "HWPX" && (
                        <td className="min-w-[190px] p-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-medium ${
                                mapping.source_field
                                  ? mapping.match_type === "exact" || mapping.match_type === "alias"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-blue-50 text-blue-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {mapping.source_field
                                ? mapping.match_type === "exact" || mapping.match_type === "alias"
                                  ? "자동 매칭"
                                  : "수동 확인 필요"
                                : "미매칭"}
                            </span>
                            {(mapping.occurrence_count || 0) > 1 && (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                                중복
                              </span>
                            )}
                          </div>
                          {(mapping.warnings || []).map((warning) => (
                            <p key={warning} className="mt-1 text-xs text-amber-700">
                              {warning}
                            </p>
                          ))}
                        </td>
                      )}
                      <td className="p-2 align-top">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            setMappings((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
                          }
                        >
                          삭제
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setMappings((rows) => [
                ...rows,
                {
                  source_field: "",
                  target_type: selected?.file_format === "HWPX" ? "HWPX_FIELD" : "EXCEL_CELL",
                  target_sheet: "",
                  target_address: "",
                  required: false,
                  default_value: "",
                  sort_order: rows.length,
                  display_name: "",
                  match_type: "manual",
                  occurrence_count: 0,
                  sections: [],
                  warnings: [],
                  present_in_file: mappingMode === "analysis" ? true : undefined,
                },
              ])
            }
          >
            매핑 추가
          </Button>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setMappingModal(false)}>
              취소
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveMappings()}>
              {saving ? "저장 중" : mappingMode === "analysis" ? "매핑 확인 및 저장" : "저장"}
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
