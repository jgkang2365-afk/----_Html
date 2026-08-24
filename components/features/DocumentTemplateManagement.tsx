"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ListPlus,
  RotateCcw,
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
  deleted_at?: string | null;
  deleted_by?: number | null;
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
type RegistrationSuccess = {
  documentName: string;
  measurementYear: number;
  measurementPeriod: Period;
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
  const [pendingMappings, setPendingMappings] = useState<Mapping[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<Definition | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState<RegistrationSuccess | null>(null);
  const analysisRequest = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateSectionRef = useRef<HTMLElement>(null);
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
  const clearTemplateDraft = () => {
    analysisRequest.current += 1;
    setAnalyzing(false);
    setFile(null);
    setConfirmedAnalysisFile("");
    setPendingMappings([]);
    setAnalysisSummary(null);
    setRegistrationSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const hasUnsavedTemplateWork = Boolean(
    file || analysisSummary || pendingMappings.length || confirmedAnalysisFile
  );
  const selectDefinition = (definitionId: string, scrollToTemplate = false) => {
    if (!definitionId || definitionId === selectedId) return;
    if (
      hasUnsavedTemplateWork &&
      !window.confirm("현재 분석 결과가 저장되지 않았습니다. 문서를 변경하시겠습니까?")
    )
      return;
    clearTemplateDraft();
    setSelectedId(definitionId);
    if (scrollToTemplate)
      window.requestAnimationFrame(() =>
        templateSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
  };
  const loadDefinitions = useCallback(async () => {
    const result = await request(
      `/api/document-definitions?include_deleted=${showDeleted ? "true" : "false"}`
    );
    const rows = responseRows<Definition>(result, ["definitions", "document_definitions", "data"]);
    setDefinitions(
      rows.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"))
    );
    setFields(responseRows<Field>(result, ["source_fields"]));
    setSelectedId((current) =>
      current && rows.some((row) => row.id === current && !row.deleted_at && row.is_active)
        ? current
        : rows.find((row) => !row.deleted_at && row.is_active)?.id || ""
    );
  }, [showDeleted]);
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
  const deleteDefinition = async () => {
    if (!deletionTarget) return;
    setSaving(true);
    try {
      await request("/api/document-definitions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deletionTarget.id }),
      });
      setDeletionTarget(null);
      await loadDefinitions();
      notify("문서 종류를 삭제했습니다. 기존 템플릿, 매핑 및 생성 이력은 보존됩니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "문서 종류 삭제에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const restoreDefinition = async (definition: Definition) => {
    setSaving(true);
    try {
      await request("/api/document-definitions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: definition.id, restore: true }),
      });
      await loadDefinitions();
      notify("문서 종류를 복구했습니다. 사용 중지 상태이므로 필요할 때 활성화해 주세요.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "문서 종류 복구에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const openMappings = async (definition: Definition) => {
    if (
      definition.id !== selectedId &&
      hasUnsavedTemplateWork &&
      !window.confirm("현재 분석 결과가 저장되지 않았습니다. 문서를 변경하시겠습니까?")
    )
      return;
    if (definition.id !== selectedId) clearTemplateDraft();
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
    setPendingMappings([]);
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
    setPendingMappings([]);
    setAnalysisSummary(null);
    setRegistrationSuccess(null);
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
      if (!file) return notify("분석한 HWPX 파일을 다시 선택해 주세요.");
      setPendingMappings(mappings.map((mapping) => ({ ...mapping })));
      setConfirmedAnalysisFile(fileKey(file));
      setMappingModal(false);
      notify("분석 결과를 확인했습니다. 등록 버튼을 누를 때 원본과 매핑을 함께 확정합니다.");
      return;
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
      notify("입력 매핑을 저장했습니다.");
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
      if (selected.file_format === "HWPX") {
        body.set("activate", "true");
        body.set(
          "mappings",
          JSON.stringify(
            pendingMappings.map((mapping, index) => ({
              source_field: mapping.source_field,
              target_type: "HWPX_FIELD",
              target_sheet: null,
              target_address: mapping.target_address,
              required: mapping.required,
              default_value: mapping.default_value ?? null,
              sort_order: index,
            }))
          )
        );
      }
      body.set("file", file);
      await request("/api/document-templates", { method: "POST", body });
      const completed: RegistrationSuccess = {
        documentName: selected.name,
        measurementYear: templateForm.measurement_year,
        measurementPeriod: templateForm.measurement_period,
      };
      await Promise.all([loadTemplates(selected.id), loadDefinitions()]);
      setFile(null);
      setConfirmedAnalysisFile("");
      setPendingMappings([]);
      setAnalysisSummary(null);
      setRegistrationSuccess(completed);
      if (fileInputRef.current) fileInputRef.current.value = "";
      notify("템플릿과 입력 매핑을 등록했습니다.");
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
  const selectedMappingCount = selected
    ? selected.mapping_count ?? selected.mappings_count ?? 0
    : 0;
  const analysisConfirmed = Boolean(
    selected?.file_format === "HWPX" && file && confirmedAnalysisFile === fileKey(file)
  );
  const showRegistrationPreview = Boolean(
    selected && file && (selected.file_format !== "HWPX" || analysisConfirmed)
  );
  if (loading)
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-center text-sm text-slate-500">
        문서 설정을 불러오는 중입니다.
      </main>
    );
  return (
    <main className="min-h-screen bg-slate-50 px-3 py-3 sm:px-4 lg:px-5">
      <div className="mx-auto max-w-[1480px] space-y-3">
        <header>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">문서 템플릿 관리</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <p className="text-slate-500">문서 종류, 입력 위치, 연도·주기별 원본 양식을 관리합니다.</p>
            <p className="font-medium text-blue-700">1 문서 종류 → 2 입력 설정 → 3 원본 등록</p>
          </div>
        </header>
        {message && (
          <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            {message}
          </p>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
            <div>
              <h2 className="text-sm font-bold text-slate-800">1. 문서 종류 관리</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">행을 선택하면 아래 템플릿 관리가 같은 문서로 전환됩니다.</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
                삭제된 문서 보기
              </label>
              <Button size="sm" className="h-8 whitespace-nowrap px-3 text-xs" onClick={() => openDefinition()}>
                <ListPlus className="mr-1 h-3.5 w-3.5" />문서 종류 추가
              </Button>
            </div>
          </div>
          <div className="max-h-[300px] overflow-auto">
            <table className="w-full min-w-[1000px] table-fixed text-xs">
              <colgroup>
                <col className="w-[190px]" /><col className="w-[58px]" /><col />
                <col className="w-[68px]" /><col className="w-[48px]" /><col className="w-[72px]" />
                <col className="w-[62px]" /><col className="w-[260px]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[11px] font-semibold text-slate-600 shadow-[0_1px_0_#e2e8f0]">
                <tr>
                  <th className="px-3 py-2">문서 종류</th><th className="px-2 py-2">형식</th>
                  <th className="px-3 py-2">출력 파일명</th><th className="px-2 py-2">기본</th>
                  <th className="px-2 py-2 text-center">순서</th><th className="px-2 py-2">상태</th>
                  <th className="px-2 py-2 text-center">매핑</th><th className="px-2 py-2 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {definitions.map((definition) => {
                  const selectable = !definition.deleted_at && definition.is_active;
                  const isSelected = definition.id === selectedId;
                  return (
                    <tr
                      key={definition.id}
                      aria-selected={isSelected}
                      tabIndex={selectable ? 0 : undefined}
                      onClick={() => selectable && selectDefinition(definition.id, true)}
                      onKeyDown={(event) => {
                        if (selectable && (event.key === "Enter" || event.key === " ")) selectDefinition(definition.id, true);
                      }}
                      className={`border-l-2 ${
                        isSelected
                          ? "border-l-blue-500 bg-blue-50/70"
                          : definition.deleted_at || !definition.is_active
                            ? "border-l-transparent bg-slate-50 text-slate-400"
                            : "cursor-pointer border-l-transparent hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <button type="button" disabled={!selectable} className="block w-full text-left font-semibold text-slate-800 disabled:text-slate-400">
                          <span className="block truncate" title={definition.name}>{definition.name}</span>
                          <span className="block truncate font-mono text-[10px] font-normal text-slate-400" title={definition.code}>{definition.code}</span>
                        </button>
                      </td>
                      <td className="px-2 py-1.5"><span className="rounded bg-slate-100 px-1.5 py-1 text-[10px] font-semibold text-slate-700">{definition.file_format}</span></td>
                      <td className="px-3 py-1.5" title={definition.filename_pattern}><code className="block truncate text-[11px] text-slate-600">{definition.filename_pattern}</code></td>
                      <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${definition.default_selected ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{definition.default_selected ? "기본" : "-"}</span></td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{definition.sort_order}</td>
                      <td className="px-2 py-1.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${definition.deleted_at ? "bg-rose-50 text-rose-700" : definition.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{definition.deleted_at ? "삭제됨" : definition.is_active ? "사용 중" : "중지"}</span></td>
                      <td className="px-2 py-1.5 text-center tabular-nums">{definition.mapping_count ?? definition.mappings_count ?? 0}개</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                          {definition.deleted_at ? (
                            <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => void restoreDefinition(definition)}><RotateCcw className="mr-1 h-3 w-3" />복구</Button>
                          ) : (
                            <>
                              <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => openDefinition(definition)}>수정</Button>
                              <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => void openMappings(definition)}>입력 설정</Button>
                              <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px]" disabled={saving} onClick={() => void toggleDefinition(definition)}>{definition.is_active ? "중지" : "재활성"}</Button>
                              <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px] text-rose-700" disabled={saving} onClick={() => setDeletionTarget(definition)}>삭제</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {definitions.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-slate-500">등록된 문서 종류가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section ref={templateSectionRef} className="scroll-mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
            <div>
              <h2 className="text-sm font-bold text-slate-800">2. 선택 문서 템플릿 관리</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                선택 문서: <strong className="text-slate-900">{selected ? `${selected.name} (${selected.file_format})` : "없음"}</strong>
              </p>
            </div>
            <div className="w-full sm:w-[390px]">
              <Select
                value={selectedId}
                onChange={(event) => selectDefinition(event.target.value)}
                options={[{ value: "", label: "문서 종류 선택" }, ...definitions.filter((definition) => !definition.deleted_at && definition.is_active).map((definition) => ({ value: definition.id, label: `${definition.name} (${definition.file_format})` }))]}
              />
            </div>
          </div>

          {selected ? (
            <>
              {selected.file_format === "HWPX" && (
                <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  <span>HWPX 파일을 선택하면 누름틀과 매핑을 분석합니다.</span>
                  <Button type="button" size="sm" variant="secondary" className="h-7 whitespace-nowrap px-2.5 text-[11px]" disabled={saving} onClick={() => void openMappings(selected)}>수동 입력 설정</Button>
                </div>
              )}

              <form id="template-upload-form" onSubmit={uploadTemplate} className="grid gap-3 border-b border-slate-200 bg-slate-50/40 p-4 md:grid-cols-[150px_170px_minmax(320px,1fr)_130px] md:items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">적용 연도</label>
                  <Input type="number" min="2000" max="2100" value={templateForm.measurement_year} onChange={(event) => setTemplateForm((previous) => ({ ...previous, measurement_year: Number(event.target.value) }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">적용 주기</label>
                  <Select value={templateForm.measurement_period} onChange={(event) => setTemplateForm((previous) => ({ ...previous, measurement_period: event.target.value as Period }))} options={[{ value: "상반기", label: "상반기" }, { value: "하반기", label: "하반기" }, { value: ANNUAL_TEMPLATE_PERIOD, label: "연간 공통" }]} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">원본 파일 ({extension(selected.file_format)})</label>
                  <Input ref={fileInputRef} type="file" accept={extension(selected.file_format)} onChange={changeTemplateFile} />
                </div>
                {selected.file_format === "HWPX" ? (
                  <Button type="button" size="sm" className="h-10 whitespace-nowrap px-3" disabled={!file || analyzing || saving || !selected.is_active} onClick={() => file && void analyzeHwpxFile(file)}>{analyzing ? "분석 중…" : "누름틀 분석"}</Button>
                ) : (
                  <div className="flex h-10 items-center rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-500">셀 매핑 흐름 유지</div>
                )}
                {!selected.is_active && <p className="text-xs text-amber-700 md:col-span-4">사용 중지된 문서 종류에는 새 템플릿을 등록할 수 없습니다.</p>}
              </form>

              {selected.file_format === "HWPX" && analysisSummary && (
                <div className="border-b border-slate-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">3. 누름틀 분석 결과</h3>
                      <p className="mt-0.5 text-[11px] text-slate-500">자동 매핑과 중복·중첩 경고를 확인합니다.</p>
                    </div>
                    <div className="grid grid-cols-4 overflow-hidden rounded-md border border-slate-200 bg-white text-center text-xs">
                      {[
                        ["총 누름틀", analysisSummary.discovered, "text-slate-800"],
                        ["고유", analysisSummary.unique, "text-slate-800"],
                        ["자동 매핑", analysisSummary.auto_matched, "text-emerald-700"],
                        ["미매핑", analysisSummary.unmatched, analysisSummary.unmatched ? "text-amber-700" : "text-emerald-700"],
                      ].map(([label, value, color]) => <div key={String(label)} className="min-w-[86px] border-r border-slate-200 px-3 py-2 last:border-r-0"><p className="text-[10px] text-slate-500">{label}</p><p className={`mt-0.5 text-base font-bold tabular-nums ${color}`}>{value}</p></div>)}
                    </div>
                  </div>
                  <div className="max-h-[330px] overflow-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[900px] table-fixed text-xs">
                      <colgroup><col className="w-[190px]" /><col className="w-[140px]" /><col className="w-[230px]" /><col /><col className="w-[210px]" /></colgroup>
                      <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[11px] font-semibold text-slate-600 shadow-[0_1px_0_#e2e8f0]"><tr><th className="px-3 py-2">누름틀명</th><th className="px-3 py-2">표시명</th><th className="px-3 py-2">자동 매핑 결과</th><th className="px-3 py-2">기본값</th><th className="px-3 py-2">상태</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {mappings.map((mapping, index) => {
                          const update = (changes: Partial<Mapping>) => {
                            setMappings((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
                            setConfirmedAnalysisFile("");
                            setPendingMappings([]);
                          };
                          const automatic = mapping.match_type === "exact" || mapping.match_type === "alias";
                          return (
                            <tr key={`${mapping.target_address}-${index}`} className={!mapping.source_field || mapping.present_in_file === false ? "bg-amber-50/60" : ""}>
                              <td className="px-3 py-2 align-top font-mono text-[11px] text-slate-700" title={mapping.target_address}><span className="block truncate">{mapping.target_address || "—"}</span>{(mapping.occurrence_count || 0) > 1 && <p className="mt-1 font-sans text-[10px] font-medium text-amber-700">동일 누름틀 {mapping.occurrence_count}회 사용</p>}</td>
                              <td className="px-3 py-2 align-top text-slate-700" title={mapping.display_name}>{mapping.display_name || "—"}</td>
                              <td className="px-3 py-1.5 align-top"><Select value={mapping.source_field} onChange={(event) => update({ source_field: event.target.value, match_type: event.target.value ? "manual" : null })} options={[{ value: "", label: "필드 선택" }, ...fieldOptions]} /></td>
                              <td className="px-3 py-2 align-top text-slate-500" title={mapping.default_value || ""}><span className="block truncate">{mapping.default_value || "—"}</span></td>
                              <td className="px-3 py-2 align-top">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${!mapping.source_field ? "bg-amber-100 text-amber-800" : automatic ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{!mapping.source_field ? "미매핑" : automatic ? "정상" : "수동 확인"}</span>
                                {(mapping.warnings || []).map((warning) => <p key={warning} className="mt-1 text-[10px] leading-4 text-amber-700">{warning}</p>)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex justify-end"><Button type="button" size="sm" variant="secondary" className="h-8 px-3 text-xs" disabled={saving || analyzing} onClick={() => void saveMappings()}>매핑 미리보기</Button></div>
                </div>
              )}

              {showRegistrationPreview && file && (
                <div className="border-b border-slate-200 bg-slate-50/30 p-4">
                  <h3 className="text-sm font-bold text-slate-800">4. 원본 및 매핑 미리보기</h3>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="text-slate-500">문서 종류</dt><dd className="mt-0.5 truncate font-semibold text-slate-800" title={selected.name}>{selected.name}</dd></div>
                    <div><dt className="text-slate-500">적용 연도·주기</dt><dd className="mt-0.5 font-semibold text-slate-800">{templateForm.measurement_year}년 {templateMeasurementPeriodLabel(templateForm.measurement_period)}</dd></div>
                    <div><dt className="text-slate-500">원본 파일</dt><dd className="mt-0.5 truncate font-semibold text-slate-800" title={file.name}>{file.name}</dd></div>
                    <div><dt className="text-slate-500">등록 상태</dt><dd className="mt-0.5 font-semibold text-slate-800">{selected.file_format === "HWPX" ? "원본 + 매핑 원자 등록" : templateForm.activate ? "활성 템플릿" : "비활성 템플릿"}</dd></div>
                    {analysisSummary && <><div><dt className="text-slate-500">누름틀</dt><dd className="mt-0.5 font-semibold">{analysisSummary.discovered}개</dd></div><div><dt className="text-slate-500">고유</dt><dd className="mt-0.5 font-semibold">{analysisSummary.unique}개</dd></div><div><dt className="text-slate-500">자동 매핑</dt><dd className="mt-0.5 font-semibold text-emerald-700">{analysisSummary.auto_matched}개</dd></div><div><dt className="text-slate-500">미매핑</dt><dd className={`mt-0.5 font-semibold ${analysisSummary.unmatched ? "text-amber-700" : "text-emerald-700"}`}>{analysisSummary.unmatched}개</dd></div></>}
                  </dl>
                  {selected.file_format !== "HWPX" && <label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={templateForm.activate} onChange={(event) => setTemplateForm((previous) => ({ ...previous, activate: event.target.checked }))} />이 연도·주기의 기본 양식으로 지정</label>}
                  <div className="mt-3 flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" className="h-8 px-3 text-xs" onClick={clearTemplateDraft}>취소</Button><Button type="submit" form="template-upload-form" size="sm" className="h-8 px-4 text-xs" disabled={saving || analyzing || !selected.is_active}><Upload className="mr-1 h-3.5 w-3.5" />{saving ? "등록 중…" : "등록"}</Button></div>
                </div>
              )}

              {registrationSuccess && (
                <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /><div><h3 className="text-sm font-bold text-emerald-900">등록 완료</h3><p className="mt-0.5 text-xs text-emerald-800">{registrationSuccess.documentName} · {registrationSuccess.measurementYear}년 {templateMeasurementPeriodLabel(registrationSuccess.measurementPeriod)} 템플릿과 매핑이 등록되었습니다.</p></div></div>
                    <Button type="button" size="sm" variant="secondary" className="h-8 px-3 text-xs" onClick={() => setRegistrationSuccess(null)}>확인</Button>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5"><div><h3 className="text-sm font-bold text-slate-800">5. 등록된 템플릿</h3><p className="mt-0.5 text-[11px] text-slate-500">현재 매핑 {selectedMappingCount}개</p></div></div>
                <div className="max-h-[300px] overflow-auto">
                  <table className="w-full min-w-[820px] table-fixed text-xs">
                    <colgroup><col className="w-[160px]" /><col className="w-[60px]" /><col /><col className="w-[90px]" /><col className="w-[170px]" /><col className="w-[110px]" /></colgroup>
                    <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[11px] font-semibold text-slate-600 shadow-[0_1px_0_#e2e8f0]"><tr><th className="px-3 py-2">적용 연도·주기</th><th className="px-3 py-2">버전</th><th className="px-3 py-2">원본 파일명</th><th className="px-3 py-2">크기</th><th className="px-3 py-2">등록일</th><th className="px-3 py-2 text-right">상태·관리</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {templates.map((template) => <tr key={template.id}><td className="px-3 py-2">{template.measurement_year}년 {templateMeasurementPeriodLabel(template.measurement_period)}</td><td className="px-3 py-2">v{template.version}</td><td className="truncate px-3 py-2" title={template.original_filename}>{template.original_filename}</td><td className="px-3 py-2">{(template.size_bytes / 1024).toFixed(1)} KB</td><td className="px-3 py-2">{new Date(template.created_at).toLocaleString("ko-KR")}</td><td className="px-3 py-1.5 text-right"><Button size="sm" variant="secondary" className="h-7 whitespace-nowrap px-2.5 text-[11px]" disabled={saving} onClick={() => void changeActive(template, !template.is_active)}>{template.is_active ? <><CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />활성</> : "활성화"}</Button></td></tr>)}
                      {templates.length === 0 && <tr><td colSpan={6} className="py-7 text-center text-slate-500"><p>등록된 템플릿이 없습니다.</p><Button type="button" size="sm" variant="secondary" className="mt-2 h-8 px-3 text-xs" onClick={() => fileInputRef.current?.click()}>원본 등록</Button></td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : <p className="p-8 text-center text-sm text-slate-500">관리할 활성 문서 종류를 선택해 주세요.</p>}
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
              {saving ? "저장 중" : mappingMode === "analysis" ? "분석 결과 확인" : "저장"}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={Boolean(deletionTarget)}
        onClose={() => setDeletionTarget(null)}
        title="문서 종류 삭제"
      >
        <div className="space-y-4 pt-5">
          <p className="font-medium text-slate-900">
            “{deletionTarget?.name}” 문서 종류를 삭제하시겠습니까?
          </p>
          <p className="text-sm leading-6 text-slate-600">
            삭제 후 신규 문서 생성 목록에서는 표시되지 않습니다. 기존 템플릿, 매핑 및 생성 이력은
            보존됩니다.
          </p>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setDeletionTarget(null)}>
              취소
            </Button>
            <Button type="button" disabled={saving} onClick={() => void deleteDefinition()}>
              {saving ? "삭제 중" : "삭제"}
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
