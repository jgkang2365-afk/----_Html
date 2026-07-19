import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

export const dynamic = "force-dynamic";

function payloadTemplates(payload: unknown): any[] {
  let parsed = payload;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const templates = (parsed as { templates?: unknown }).templates;
  if (!templates || typeof templates !== "object") return [];
  return Object.values(templates);
}

function normalizedId(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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
    .select("payload, status")
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
  const templateEntries = payloadTemplates(job.payload);
  const selected = templateEntries.find(
    (template) => normalizedId(template?.template_id) === requestedTemplateId
  );
  if (!selected) {
    console.warn("[DocumentWorker] 작업에 포함되지 않은 템플릿 요청:", {
      jobId: params.id,
      templateId: params.templateId,
      payloadTemplateIds: templateEntries.map((template) => normalizedId(template?.template_id)),
    });
    return NextResponse.json({ error: "작업에 포함되지 않은 템플릿입니다." }, { status: 403 });
  }
  const { data: template } = await admin
    .from("document_templates")
    .select("*")
    .eq("id", requestedTemplateId)
    .maybeSingle();
  if (
    !template ||
    template.storage_path !== selected.storage_path ||
    template.version !== selected.version
  )
    return NextResponse.json(
      { error: "작업에 고정된 템플릿과 일치하지 않습니다." },
      { status: 409 }
    );
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
