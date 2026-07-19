"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FilePlus2, Loader2, RotateCcw } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import {
  DOCUMENT_TYPE_META,
  DOCUMENT_TYPES,
  DocumentType,
} from "@/lib/document-generation/constants";

interface Props {
  businessId: number;
  business: Record<string, any>;
}

interface GenerationContext {
  job: null | {
    id: string;
    status: "NOT_REQUESTED" | "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL_SUCCESS" | "FAILED";
    error_message?: string | null;
    result_files?: Array<{
      document_type: DocumentType;
      status: string;
      filename?: string;
      path?: string;
      error?: string;
    }>;
  };
  templates: Array<{
    id: string;
    document_type: DocumentType;
    version: number;
    original_filename: string;
  }>;
  outputPath: string | null;
  snapshot?: Record<string, any>;
}

const STATUS_LABELS: Record<string, string> = {
  NOT_REQUESTED: "신규 문서 생성",
  PENDING: "요청 대기",
  PROCESSING: "처리 중",
  COMPLETED: "생성 완료",
  PARTIAL_SUCCESS: "일부 실패",
  FAILED: "다시 생성",
};

function missingValues(type: DocumentType, business: Record<string, any>) {
  const common: Array<[string, string]> = [
    ["representative_name", "대표자"],
    ["address", "주소"],
    ["business_category", "업종"],
    ["phone", "전화번호"],
    ["main_product", "주요 생산품"],
    ["fax", "팩스번호"],
    ["total_employees", "총 근로자 수"],
    ["manager_name", "담당자명"],
    ["manager_email", "담당자 메일"],
  ];
  const fields =
    type === "GENERAL_PRELIMINARY_SURVEY"
      ? [
          ...common,
          ["preliminary_surveyor", "예비조사자"] as [string, string],
          ["business_number", "사업자등록번호"] as [string, string],
          ["industrial_accident_number", "산재관리번호"] as [string, string],
        ]
      : type === "FIELD_PRELIMINARY_SURVEY"
        ? common
        : ([
            ["manager_name", "담당자명"],
            ["manager_email", "담당자 메일"],
            ["invoice_email", "계산서 메일"],
          ] as Array<[string, string]>);
  return fields.filter(([key]) => !String(business[key] ?? "").trim()).map(([, label]) => label);
}

export function NewBusinessDocumentGeneration({ businessId, business }: Props) {
  const [context, setContext] = useState<GenerationContext | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadContext = useCallback(
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
    void loadContext();
  }, [loadContext]);
  useEffect(() => {
    if (!context?.job || !["PENDING", "PROCESSING"].includes(context.job.status)) return;
    const timer = window.setInterval(() => void loadContext(true), 3000);
    return () => window.clearInterval(timer);
  }, [context?.job, loadContext]);

  const available = useMemo(
    () => new Set((context?.templates || []).map((template) => template.document_type)),
    [context?.templates]
  );
  const openSelector = () => {
    const failedTypes = (context?.job?.result_files || [])
      .filter((file) => file.status !== "COMPLETED" && available.has(file.document_type))
      .map((file) => file.document_type);
    setSelected(
      ["PARTIAL_SUCCESS", "FAILED"].includes(context?.job?.status || "") && failedTypes.length > 0
        ? failedTypes
        : DOCUMENT_TYPES.filter((type) => available.has(type))
    );
    setError("");
    setIsOpen(true);
  };

  const hasRequiredContext = Boolean(
    businessId &&
    String(business.business_name ?? "").trim() &&
    String(business.year ?? "").trim() &&
    String(business.period ?? "").trim() &&
    String(business.code ?? "").trim()
  );

  if (loading || !context?.job || !hasRequiredContext) return null;

  const status = context.job.status;
  const isRunning = status === "PENDING" || status === "PROCESSING";
  const isComplete = status === "COMPLETED";

  const requestGeneration = async () => {
    if (selected.length === 0) {
      setError("생성할 문서를 하나 이상 선택해 주세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/document-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, selected_documents: selected }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "문서 생성 요청 실패");
      await loadContext(true);
      setIsOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "문서 생성 요청 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={isComplete ? "secondary" : "primary"}
        disabled={isRunning}
        onClick={openSelector}
        className="whitespace-nowrap"
      >
        {isRunning ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : isComplete ? (
          <CheckCircle2 className="mr-1.5 h-4 w-4 text-emerald-600" />
        ) : status === "FAILED" || status === "PARTIAL_SUCCESS" ? (
          <RotateCcw className="mr-1.5 h-4 w-4" />
        ) : (
          <FilePlus2 className="mr-1.5 h-4 w-4" />
        )}
        {STATUS_LABELS[status] || "신규 문서 생성"}
      </Button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="신규 문서 생성" size="lg">
        <div className="space-y-5 p-1 pt-5">
          <div className="border-y border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">저장 예정 경로</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-600">{context.outputPath}</p>
          </div>

          {context.job.result_files && context.job.result_files.length > 0 && (
            <div className="border-y border-slate-200">
              {context.job.result_files.map((file) => (
                <div
                  key={`${file.document_type}-${file.filename || file.error}`}
                  className="border-b border-slate-100 px-4 py-3 last:border-0"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    {DOCUMENT_TYPE_META[file.document_type]?.label || file.document_type}:{" "}
                    {file.status === "COMPLETED" ? "완료" : "실패"}
                  </p>
                  {file.filename && <p className="mt-1 text-xs text-slate-600">{file.filename}</p>}
                  {file.path && (
                    <p className="mt-1 break-all font-mono text-xs text-slate-500">{file.path}</p>
                  )}
                  {file.error && <p className="mt-1 text-xs text-red-600">{file.error}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-3">
            {DOCUMENT_TYPES.map((type) => {
              const template = context.templates.find((item) => item.document_type === type);
              const missing = missingValues(type, context.snapshot || business);
              return (
                <label
                  key={type}
                  className={`flex items-start gap-3 border-b border-slate-100 px-1 py-3 ${template && !isComplete ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!template || isComplete}
                    checked={selected.includes(type)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, type]
                          : previous.filter((item) => item !== type)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-800">
                      {DOCUMENT_TYPE_META[type].label}
                    </span>
                    {template ? (
                      <span className="block text-xs text-slate-500">
                        v{template.version} · {template.original_filename}
                      </span>
                    ) : (
                      <span className="block text-xs text-red-600">
                        해당 연도·주기의 활성 템플릿이 없습니다.
                      </span>
                    )}
                    {template && missing.length > 0 && (
                      <span className="mt-1 block text-xs text-amber-700">
                        빈칸 생성: {missing.join(", ")}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {(status === "FAILED" || status === "PARTIAL_SUCCESS") && context.job.error_message && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {context.job.error_message}
            </p>
          )}
          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <p className="text-xs text-slate-500">
            누락된 값은 빈칸으로 생성됩니다. 현재 DB에 저장된 값을 기준으로 계속하시겠습니까?
          </p>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            {isComplete ? (
              <Button type="button" onClick={() => setIsOpen(false)}>
                확인
              </Button>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
                  취소
                </Button>
                <Button
                  type="button"
                  onClick={requestGeneration}
                  disabled={submitting || available.size === 0}
                >
                  {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}선택 문서 생성
                </Button>
              </>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
