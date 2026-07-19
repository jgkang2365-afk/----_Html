import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DOCUMENT_TYPE_META,
  isDocumentType,
  normalizeMeasurementPeriod,
  sanitizeWindowsFilename,
} from "@/lib/document-generation/constants";

export const dynamic = "force-dynamic";
const MAX_TEMPLATE_BYTES = 100 * 1024 * 1024;

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value !== "string" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.arrayBuffer === "function"
  );
}

async function requireAdmin() {
  const user = await getUser();
  if (!user || user.role !== "관리자") throw new Error("ADMIN_REQUIRED");
  return user;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";
    if (activeOnly) await checkPermission("journal:write");
    else await requireAdmin();
    const admin = createAdminClient();
    let query = admin
      .from("document_templates")
      .select("*")
      .order("measurement_year", { ascending: false })
      .order("measurement_period")
      .order("document_type")
      .order("version", { ascending: false });
    const year = Number(searchParams.get("year"));
    const period = normalizeMeasurementPeriod(searchParams.get("period"));
    if (Number.isInteger(year)) query = query.eq("measurement_year", year);
    if (period) query = query.eq("measurement_period", period);
    if (activeOnly) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ templates: data || [] });
  } catch (error: any) {
    const forbidden = error?.message === "ADMIN_REQUIRED";
    return NextResponse.json(
      { error: forbidden ? "관리자만 접근할 수 있습니다." : error?.message || "템플릿 조회 실패" },
      { status: forbidden ? 403 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let uploadedPath = "";
  let createdTemplateId = "";
  let stage = "VALIDATE";
  const correlationId = randomUUID();
  try {
    const user = await requireAdmin();
    const form = await request.formData();
    const file = form.get("file");
    const documentType = form.get("document_type");
    const year = Number(form.get("measurement_year"));
    const period = normalizeMeasurementPeriod(form.get("measurement_period"));
    const activate = String(form.get("activate")) !== "false";
    if (
      !isUploadedFile(file) ||
      !isDocumentType(documentType) ||
      !Number.isInteger(year) ||
      !period
    )
      return NextResponse.json(
        { error: "문서 종류, 연도, 주기, 파일을 확인해 주세요." },
        { status: 400 }
      );
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (extension !== DOCUMENT_TYPE_META[documentType].extension)
      return NextResponse.json(
        {
          error: `${DOCUMENT_TYPE_META[documentType].label}은 ${DOCUMENT_TYPE_META[documentType].extension} 파일만 등록할 수 있습니다.`,
        },
        { status: 400 }
      );
    if (file.size <= 0 || file.size > MAX_TEMPLATE_BYTES)
      return NextResponse.json(
        { error: "빈 파일이거나 템플릿 최대 크기(100MB)를 초과했습니다." },
        { status: 400 }
      );

    const admin = createAdminClient();
    stage = "VERSION_LOOKUP";
    const { data: latest, error: versionError } = await admin
      .from("document_templates")
      .select("version")
      .eq("document_type", documentType)
      .eq("measurement_year", year)
      .eq("measurement_period", period)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) throw versionError;
    const version = Number(latest?.version || 0) + 1;
    const bytes = Buffer.from(await file.arrayBuffer());
    uploadedPath = `${year}/${period}/${documentType}/v${version}-${randomUUID()}-${sanitizeWindowsFilename(file.name, `template${extension}`)}`;
    stage = "STORAGE_UPLOAD";
    const { error: uploadError } = await admin.storage
      .from("document-templates")
      .upload(uploadedPath, bytes, {
        contentType:
          extension === ".xlsm"
            ? "application/vnd.ms-excel.sheet.macroEnabled.12"
            : "application/octet-stream",
        upsert: false,
      });
    if (uploadError) throw uploadError;
    stage = "DATABASE_INSERT";
    const { data: created, error: insertError } = await admin
      .from("document_templates")
      .insert({
        document_type: documentType,
        measurement_year: year,
        measurement_period: period,
        version,
        original_filename: file.name,
        storage_path: uploadedPath,
        is_active: false,
        uploaded_by: Number(user.id),
        size_bytes: file.size,
        extension,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })
      .select("*")
      .single();
    if (insertError) throw insertError;
    createdTemplateId = created.id;
    let template = created;
    if (activate) {
      stage = "TEMPLATE_ACTIVATE";
      const activated = await admin.rpc("activate_document_template", {
        p_template_id: created.id,
      });
      if (activated.error) throw activated.error;
      template = activated.data;
    }
    return NextResponse.json({ success: true, template });
  } catch (error: any) {
    const admin = createAdminClient();
    if (createdTemplateId)
      await admin.from("document_templates").delete().eq("id", createdTemplateId);
    if (uploadedPath) await admin.storage.from("document-templates").remove([uploadedPath]);
    const forbidden = error?.message === "ADMIN_REQUIRED";
    const errorCode = forbidden
      ? "DOCUMENT_TEMPLATE_ADMIN_REQUIRED"
      : "DOCUMENT_TEMPLATE_" + stage + "_FAILED";
    console.error("[DocumentTemplates] 업로드 실패:", {
      correlationId,
      errorCode,
      stage,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    const message = forbidden
      ? "관리자만 템플릿을 등록할 수 있습니다."
      : "템플릿 등록에 실패했습니다. (단계: " + stage + ", 추적번호: " + correlationId + ")";
    return NextResponse.json(
      { error: message, errorCode, correlationId },
      { status: forbidden ? 403 : 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
    const { id, is_active } = await request.json();
    if (!id || typeof is_active !== "boolean")
      return NextResponse.json({ error: "템플릿 ID와 활성 상태가 필요합니다." }, { status: 400 });
    const admin = createAdminClient();
    if (is_active) {
      const result = await admin.rpc("activate_document_template", { p_template_id: id });
      if (result.error) throw result.error;
      return NextResponse.json({ success: true, template: result.data });
    }
    const { data, error } = await admin
      .from("document_templates")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, template: data });
  } catch (error: any) {
    const forbidden = error?.message === "ADMIN_REQUIRED";
    return NextResponse.json(
      { error: forbidden ? "관리자만 변경할 수 있습니다." : "템플릿 상태 변경에 실패했습니다." },
      { status: forbidden ? 403 : 500 }
    );
  }
}
