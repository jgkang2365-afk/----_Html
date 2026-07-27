"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, FileSpreadsheet, FileText, Loader2, RotateCcw } from "lucide-react";
import { Button, Modal } from "@/components/ui";
type Document = {
  definition?: {
    id: string;
    code?: string;
    name?: string;
    file_format?: string;
    default_selected?: boolean;
  };
  document_definition_id?: string;
  id?: string;
  code?: string;
  name?: string;
  document_name?: string;
  file_format?: string;
  default_selected?: boolean;
  template?: {
    id: string;
    version?: number;
    original_filename?: string;
    measurement_period?: string;
  } | null;
  available?: boolean;
  reason?: string;
  unavailable_reason?: string;
};
type ResultFile = {
  document_definition_id?: string;
  document_type?: string;
  document_name?: string;
  status: string;
  filename?: string;
  path?: string;
  error?: string;
};
type Context = {
  eligible: boolean;
  hasActualMeasurementJournal: boolean;
  outputPath: string | null;
  documents?: Document[];
  templates?: unknown[];
  job: null | {
    id: string;
    status: string;
    error_message?: string | null;
    result_files?: ResultFile[];
  };
  snapshot?: Record<string, unknown>;
};
const STATUS_LABELS: Record<string, string> = {
  NOT_REQUESTED: "문서 생성",
  PENDING: "문서 생성 중",
  PROCESSING: "문서 생성 중",
  COMPLETED: "문서 재생성",
  PARTIAL_SUCCESS: "다시 생성",
  FAILED: "다시 생성",
};
const documentId = (document: Document) =>
  document.definition?.id || document.document_definition_id || document.id || document.code || "";
// API는 code와 definition id를 모두 허용한다. UI 상태는 항상 안정적인 definition id로 유지한다.
const documentSelection = (document: Document) => documentId(document);
const documentCode = (document: Document) => document.definition?.code || document.code || "";
const documentName = (document: Document) =>
  document.definition?.name ||
  document.name ||
  document.document_name ||
  document.definition?.code ||
  document.code ||
  "문서";
const isAvailable = (document: Document) =>
  document.available !== false && Boolean(document.template || document.available);
export function NewBusinessDocumentGeneration({
  businessId,
  business,
  documentGenerationEnabled,
  hasActualMeasurementJournal,
}: {
  businessId: number;
  business: Record<string, any>;
  documentGenerationEnabled?: boolean;
  hasActualMeasurementJournal?: boolean;
}) {
  const [context, setContext] = useState<Context | null>(null),
    [isOpen, setIsOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await fetch(`/api/document-generation?businessId=${businessId}`, {
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "문서 생성 상태 조회 실패");
        setContext(result);
        setError("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "문서 생성 상태 조회 실패");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [businessId]
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!context?.job || !["PENDING", "PROCESSING"].includes(context.job.status)) return;
    const timer = window.setInterval(() => void load(true), 3000);
    return () => window.clearInterval(timer);
  }, [context?.job, load]);
  const documents = useMemo(
    () => (Array.isArray(context?.documents) ? context!.documents : []),
    [context]
  );
  const status = context?.job?.status || "NOT_REQUESTED";
  const isRunning = ["PENDING", "PROCESSING"].includes(status);
  const isComplete = status === "COMPLETED";
  const canRender = Boolean(
    businessId &&
    String(business.business_name ?? "").trim() &&
    String(business.year ?? "").trim() &&
    String(business.period ?? "").trim() &&
    String(business.code ?? "").trim()
  );
  const canShowWhileLoading =
    loading && documentGenerationEnabled === true && hasActualMeasurementJournal === false;
  const open = () => {
    const failed = new Set(
      (context?.job?.result_files || [])
        .filter((file) => file.status !== "COMPLETED")
        .map((file) => file.document_definition_id || file.document_type)
    );
    const retry = ["PARTIAL_SUCCESS", "FAILED"].includes(status)
      ? documents
          .filter(
            (document) =>
              failed.has(documentId(document)) ||
              failed.has(documentSelection(document)) ||
              failed.has(documentCode(document))
          )
          .map(documentSelection)
          .filter(Boolean)
      : [];
    setSelected(
      retry.length
        ? retry
        : documents
            .filter(
              (document) =>
                isAvailable(document) &&
                (document.definition?.default_selected ?? document.default_selected ?? true)
            )
            .map(documentSelection)
            .filter(Boolean)
    );
    setError("");
    setIsOpen(true);
  };
  const submit = async () => {
    if (!selected.length) return setError("생성할 문서를 하나 이상 선택해 주세요.");
    setSubmitting(true);
    try {
      const response = await fetch("/api/document-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, selected_documents: selected }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "문서 생성 요청 실패");
      await load(true);
      setIsOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "문서 생성 요청 실패");
    } finally {
      setSubmitting(false);
    }
  };
  if (
    !canRender ||
    (!canShowWhileLoading && (!context?.eligible || context.hasActualMeasurementJournal))
  )
    return null;
  return (
    <>
      <Button
        type="button"
        variant={isComplete ? "secondary" : "primary"}
        disabled={loading || isRunning}
        onClick={open}
        className="whitespace-nowrap"
      >
        {loading || isRunning ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : isComplete || status === "FAILED" || status === "PARTIAL_SUCCESS" ? (
          <RotateCcw className="mr-1.5 h-4 w-4" />
        ) : (
          <FilePlus2 className="mr-1.5 h-4 w-4" />
        )}
        {loading ? "문서 생성" : STATUS_LABELS[status] || "문서 생성"}
      </Button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={isComplete ? "문서 재생성" : "문서 생성"}
        size="lg"
      >
        <div className="space-y-5 p-1 pt-5">
          <div className="border-y border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold">저장 예정 경로</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-600">{context?.outputPath}</p>
          </div>
          {(context?.job?.result_files || []).map((file, index) => (
            <div
              key={`${file.document_definition_id || file.document_type || index}-${file.filename || file.error}`}
              className="border-b border-slate-100 px-1 py-2 text-sm"
            >
              <b>
                {file.document_name || file.document_type || "문서"}:{" "}
                {file.status === "COMPLETED" ? "완료" : "실패"}
              </b>
              {file.filename && <p className="text-xs text-slate-600">{file.filename}</p>}
              {file.error && <p className="text-xs text-red-600">{file.error}</p>}
            </div>
          ))}
          <div className="space-y-2">
            {documents.map((document) => {
              const id = documentId(document),
                available = isAvailable(document),
                format = document.definition?.file_format || document.file_format;
              return (
                <label
                  key={id || documentName(document)}
                  className={`flex gap-3 border-b border-slate-100 px-1 py-3 ${available ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                >
                  <input
                    className="mt-1"
                    type="checkbox"
                    disabled={!available}
                    checked={selected.includes(id)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, id]
                          : previous.filter((value) => value !== id)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-semibold text-slate-800">
                      {format === "HWPX" ? (
                        <FileText className="h-4 w-4 text-blue-600" />
                      ) : (
                        <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                      )}
                      {documentName(document)}{" "}
                      <small className="font-normal text-slate-500">{format}</small>
                    </span>
                    {available && document.template ? (
                      <span className="block text-xs text-slate-500">
                        v{document.template.version} ·{" "}
                        {document.template.measurement_period === "annual"
                          ? "연간 공통"
                          : document.template.measurement_period}{" "}
                        · {document.template.original_filename}
                      </span>
                    ) : (
                      <span className="block text-xs text-red-600">
                        {document.reason ||
                          document.unavailable_reason ||
                          "해당 연도·주기의 활성 템플릿이 없습니다."}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
            {!documents.length && (
              <p className="py-5 text-center text-sm text-slate-500">
                적용 가능한 문서 정의가 없습니다.
              </p>
            )}
          </div>
          {error && (
            <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              disabled={submitting || !documents.some(isAvailable)}
              onClick={() => void submit()}
            >
              {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {isComplete ? "선택 문서 재생성" : "선택 문서 생성"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
