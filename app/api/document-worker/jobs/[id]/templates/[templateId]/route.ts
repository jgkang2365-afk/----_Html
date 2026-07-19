import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedDocumentWorker } from "@/lib/document-generation/worker-auth";

export const dynamic = "force-dynamic";

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
  const templateEntries = Object.values(job?.payload?.templates || {}) as any[];
  const selected = templateEntries.find((template) => template.template_id === params.templateId);
  if (!job || !selected || job.status !== "PROCESSING")
    return NextResponse.json({ error: "템플릿 다운로드 권한이 없습니다." }, { status: 403 });
  const { data: template } = await admin
    .from("document_templates")
    .select("*")
    .eq("id", params.templateId)
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
