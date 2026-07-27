import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";
import { isTemplatePeriodApplicable } from "@/lib/document-generation/template-selection";

export const dynamic = "force-dynamic";

function normalizedId(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function selectedDocumentTypes(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; templateId: string } }
) {
  if (!isAuthorizedDocumentWorker(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("document_generation_jobs")
    .select("status, selected_documents, measurement_year, measurement_period")
    .eq("id", params.id)
    .maybeSingle();
  if (!job)
    return NextResponse.json({ error: "문서 생성 작업을 찾을 수 없습니다." }, { status: 404 });
  if (job.status !== "PROCESSING") {
    console.warn("[DocumentWorker] 처리 중이 아닌 작업의 템플릿 요청:", {
      jobId: params.id,
      templateId: params.templateId,
      status: job.status,
    });
    return NextResponse.json(
      { error: "문서 생성 작업 상태가 PROCESSING이 아닙니다. (현재: " + job.status + ")" },
      { status: 409 }
    );
  }

  const requestedTemplateId = normalizedId(params.templateId);
  const { data: template } = await admin
    .from("document_templates")
    .select("*")
    .eq("id", requestedTemplateId)
    .maybeSingle();
  if (!template)
    return NextResponse.json({ error: "요청한 템플릿을 찾을 수 없습니다." }, { status: 404 });

  const selectedDocuments = selectedDocumentTypes(job.selected_documents);
  if (!selectedDocuments.includes(template.document_type)) {
    console.warn("[DocumentWorker] 작업에서 선택하지 않은 문서 템플릿 요청:", {
      jobId: params.id,
      templateId: params.templateId,
      documentType: template.document_type,
      selectedDocuments,
    });
    return NextResponse.json(
      { error: "작업에서 선택하지 않은 문서 템플릿입니다." },
      { status: 403 }
    );
  }
  if (
    Number(template.measurement_year) !== Number(job.measurement_year) ||
    !isTemplatePeriodApplicable(template.measurement_period, job.measurement_period)
  ) {
    console.warn("[DocumentWorker] 작업 연도·주기와 다른 템플릿 요청:", {
      jobId: params.id,
      templateId: params.templateId,
      templateYear: template.measurement_year,
      templatePeriod: template.measurement_period,
      jobYear: job.measurement_year,
      jobPeriod: job.measurement_period,
    });
    return NextResponse.json(
      { error: "작업 연도·주기와 템플릿이 일치하지 않습니다." },
      { status: 409 }
    );
  }

  const { data: file, error } = await admin.storage
    .from("document-templates")
    .download(template.storage_path);
  if (error || !file) {
    console.error("[DocumentWorker] 템플릿 다운로드 실패:", {
      templateId: template.id,
      storagePath: template.storage_path,
      code: error?.name,
      message: error?.message,
    });
    return NextResponse.json({ error: "템플릿 파일 다운로드 실패" }, { status: 500 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type":
        template.extension === ".xlsm"
          ? "application/vnd.ms-excel.sheet.macroEnabled.12"
          : "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
