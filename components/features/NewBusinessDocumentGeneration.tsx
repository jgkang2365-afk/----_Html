"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, FileSpreadsheet, FileText, Loader2, RotateCcw } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import {
  DOCUMENT_GENERATION_STATUS_LABELS,
  documentGenerationPollDelay,
  isDocumentGenerationRunning,
  shouldApplyDocumentGenerationResponse,
} from "@/lib/document-generation/polling";
import {
  documentDefinitionDisplayName,
  isNewBusinessDocumentGenerationEligible,
} from "@/lib/document-generation/business-eligibility";
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
    requested_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    updated_at?: string | null;
    worker_id?: string | null;
    attempt_count?: number | null;
    error_message?: string | null;
    result_files?: ResultFile[];
  };
  snapshot?: Record<string, unknown>;
};
const documentId = (document: Document) =>
  document.definition?.id || document.document_definition_id || document.id || document.code || "";
// API는 code와 definition id를 모두 허용한다. UI 상태는 항상 안정적인 definition id로 유지한다.
const documentSelection = (document: Document) => documentId(document);
const documentCode = (document: Document) => document.definition?.code || document.code || "";
const documentName = (document: Document) =>
  documentDefinitionDisplayName({
    code: document.definition?.code || document.code,
    name: document.definition?.name || document.name || document.document_name,
  });
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
    [refreshing, setRefreshing] = useState(false),
    [currentTime, setCurrentTime] = useState(() => Date.now()),
    [error, setError] = useState("");
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const load = useCallback(
    async (silent = false) => {
      const sequence = ++requestSequence.current;
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      if (!silent) setLoading(true);
      try {
        const response = await fetch(`/api/document-generation?businessId=${businessId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "문서 생성 상태 조회 실패");
        if (!shouldApplyDocumentGenerationResponse(sequence, requestSequence.current)) return;
        setContext(result);
        setError("");
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (!shouldApplyDocumentGenerationResponse(sequence, requestSequence.current)) return;
        setError(caught instanceof Error ? caught.message : "문서 생성 상태 조회 실패");
      } finally {
        if (shouldApplyDocumentGenerationResponse(sequence, requestSequence.current)) {
          requestController.current = null;
          if (!silent) setLoading(false);
        }
      }
    },
    [businessId]
  );
  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [load]);
  const status = context?.job?.status || "NOT_REQUESTED";
  const isRunning = isDocumentGenerationRunning(status);
  useEffect(() => {
    const delay = documentGenerationPollDelay(status);
    if (delay === null) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await load(true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };
    timer = window.setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [status, load]);
  useEffect(() => {
    if (!isRunning) return;
    setCurrentTime(Date.now());
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isRunning, context?.job?.requested_at]);
  const documents = useMemo(
    () => (Array.isArray(context?.documents) ? context!.documents : []),
    [context]
  );
  const isComplete = status === "COMPLETED";
  const requestedAt = context?.job?.requested_at
    ? new Date(context.job.requested_at).getTime()
    : Number.NaN;
  const isLongRunning =
    isRunning && Number.isFinite(requestedAt) && currentTime - requestedAt >= 300000;
  const canRender = Boolean(
    businessId &&
    String(business.business_name ?? "").trim() &&
    String(business.year ?? "").trim() &&
    String(business.period ?? "").trim() &&
    String(business.code ?? "").trim()
  );
  const canShowWhileLoading =
    loading &&
    documentGenerationEnabled === true &&
    hasActualMeasurementJournal === false &&
    isNewBusinessDocumentGenerationEligible({
      document_generation_enabled: documentGenerationEnabled,
      business_type: business.business_type,
      business_category: business.business_category,
    });
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
  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };
  if (
    !canRender ||
    (!canShowWhileLoading && (!context?.eligible || context.hasActualMeasurementJournal))
  )
    return null;
  return (
    <>
      <div className="flex items-center gap-2">
        {isRunning && (
          <span className="max-w-xs text-xs text-slate-500">
            {isLongRunning
              ? "문서 생성이 예상보다 오래 걸리고 있습니다. 작업 상태를 계속 확인하고 있습니다."
              : "문서를 생성하고 있습니다."}
          </span>
        )}
        {isRunning && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={refreshing}
            onClick={() => void refreshStatus()}
            className="whitespace-nowrap"
          >
            {refreshing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            상태 새로고침
          </Button>
        )}
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
          {loading ? "문서 생성" : DOCUMENT_GENERATION_STATUS_LABELS[status] || "문서 생성"}
        </Button>
      </div>
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
                {documentDefinitionDisplayName({
                  code: file.document_type,
                  name: file.document_name,
                })}:{" "}
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
