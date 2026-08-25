import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseTemplateMeasurementPeriod,
  templateMeasurementPeriodStorageSegment,
} from "@/lib/document-generation/constants";
import {
  documentExtension,
  parseDocumentFieldMappings,
} from "@/lib/document-generation/definitions";

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
      .select("*, document_definition:document_definitions!inner(*)")
      .order("measurement_year", { ascending: false })
      .order("measurement_period")
      .order("document_type")
      .order("version", { ascending: false });
    const year = Number(searchParams.get("year"));
    const periodValue = searchParams.get("period");
    const period = parseTemplateMeasurementPeriod(periodValue);
    if (Number.isInteger(year)) query = query.eq("measurement_year", year);
    if (periodValue !== null && !period)
      return NextResponse.json({ error: "지원하지 않는 적용 주기입니다." }, { status: 400 });
    if (period) query = query.eq("measurement_period", period);
    const definitionId = searchParams.get("document_definition_id");
    if (definitionId) query = query.eq("document_definition_id", definitionId);
    if (activeOnly)
      query = query
        .eq("is_active", true)
        .eq("document_definition.is_active", true)
        .is("document_definition.deleted_at", null);
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
    const definitionId = String(form.get("document_definition_id") ?? "").trim();
    const legacyDocumentType = String(form.get("document_type") ?? "").trim();
    const year = Number(form.get("measurement_year"));
    const period = parseTemplateMeasurementPeriod(form.get("measurement_period"));
    const activate = String(form.get("activate")) !== "false";
    if (!period)
      return NextResponse.json({ error: "지원하지 않는 적용 주기입니다." }, { status: 400 });
    if (!isUploadedFile(file) || (!definitionId && !legacyDocumentType) || !Number.isInteger(year))
      return NextResponse.json(
        { error: "문서 종류, 연도, 주기, 파일을 확인해 주세요." },
        { status: 400 }
      );
    const admin = createAdminClient();
    let definitionQuery = admin.from("document_definitions").select("*");
    definitionQuery = definitionId
      ? definitionQuery.eq("id", definitionId)
      : definitionQuery.eq("code", legacyDocumentType);
    const { data: definition, error: definitionError } = await definitionQuery.maybeSingle();
    if (definitionError) throw definitionError;
    if (!definition)
      return NextResponse.json({ error: "문서 종류를 찾을 수 없습니다." }, { status: 404 });
    if (definition.deleted_at)
      return NextResponse.json(
        { error: "삭제된 문서 종류에는 새 템플릿을 등록할 수 없습니다." },
        { status: 409 }
      );
    if (!definition.is_active)
      return NextResponse.json(
        { error: "사용중지된 문서 종류에는 새 템플릿을 등록할 수 없습니다." },
        { status: 409 }
      );
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const expectedExtension = documentExtension(definition.file_format);
    if (extension !== expectedExtension)
      return NextResponse.json(
        {
          error: `${definition.name}은 ${expectedExtension} 파일만 등록할 수 있습니다.`,
        },
        { status: 400 }
      );
    if (file.size <= 0 || file.size > MAX_TEMPLATE_BYTES)
      return NextResponse.json(
        { error: "빈 파일이거나 템플릿 최대 크기(100MB)를 초과했습니다." },
        { status: 400 }
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (definition.file_format === "HWPX") {
      let mappings;
      try {
        mappings = parseDocumentFieldMappings(
          JSON.parse(String(form.get("mappings") ?? "null")),
          "HWPX"
        );
      } catch (error: any) {
        return NextResponse.json(
          { error: error?.message || "확정할 HWPX 매핑을 확인해 주세요." },
          { status: 400 }
        );
      }
      if (!activate)
        return NextResponse.json(
          { error: "HWPX 신규 원본은 매핑과 함께 활성화해야 합니다." },
          { status: 400 }
        );
      const periodSegment = templateMeasurementPeriodStorageSegment(period);
      uploadedPath = `${year}/${periodSegment}/${definition.code}/staging-${randomUUID()}${extension}`;
      stage = "STORAGE_UPLOAD";
      const { error: uploadError } = await admin.storage
        .from("document-templates")
        .upload(uploadedPath, bytes, { contentType: "application/octet-stream", upsert: false });
      if (uploadError) throw uploadError;
      stage = "ATOMIC_FINALIZE";
      const finalized = await admin.rpc("finalize_hwpx_document_template", {
        p_document_definition_id: definition.id,
        p_measurement_year: year,
        p_measurement_period: period,
        p_original_filename: file.name,
        p_storage_path: uploadedPath,
        p_uploaded_by: Number(user.id),
        p_size_bytes: file.size,
        p_extension: extension,
        p_sha256: hash,
        p_mappings: mappings,
      });
      if (finalized.error) throw finalized.error;
      return NextResponse.json({ success: true, template: finalized.data });
    }

    stage = "VERSION_LOOKUP";
    const { data: latest, error: versionError } = await admin
      .from("document_templates")
      .select("version")
      .eq("document_definition_id", definition.id)
      .eq("measurement_year", year)
      .eq("measurement_period", period)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) throw versionError;
    const version = Number(latest?.version || 0) + 1;
    const periodSegment = templateMeasurementPeriodStorageSegment(period);
    uploadedPath = `${year}/${periodSegment}/${definition.code}/v${version}-${randomUUID()}${extension}`;
    stage = "STORAGE_UPLOAD";
    const { error: uploadError } = await admin.storage
      .from("document-templates")
      .upload(uploadedPath, bytes, {
        contentType:
          extension === ".xlsm"
            ? "application/vnd.ms-excel.sheet.macroEnabled.12"
            : extension === ".xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "application/octet-stream",
        upsert: false,
      });
    if (uploadError) throw uploadError;
    stage = "DATABASE_INSERT";
    const { data: created, error: insertError } = await admin
      .from("document_templates")
      .insert({
        document_definition_id: definition.id,
        document_type: definition.code,
        measurement_year: year,
        measurement_period: period,
        version,
        original_filename: file.name,
        storage_path: uploadedPath,
        is_active: false,
        uploaded_by: Number(user.id),
        size_bytes: file.size,
        extension,
        sha256: hash,
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
    const mappingRequired =
      error?.code === "DOCUMENT_MAPPING_REQUIRED" || error?.message === "DOCUMENT_MAPPING_REQUIRED";
    const definitionInactive =
      error?.code === "DOCUMENT_DEFINITION_INACTIVE" ||
      error?.message === "DOCUMENT_DEFINITION_INACTIVE";
    const definitionDeleted = String(error?.message || "").includes("DOCUMENT_DEFINITION_DELETED");
    const errorCode = forbidden
      ? "DOCUMENT_TEMPLATE_ADMIN_REQUIRED"
      : mappingRequired
        ? "DOCUMENT_MAPPING_REQUIRED"
        : definitionDeleted
          ? "DOCUMENT_DEFINITION_DELETED"
          : definitionInactive
            ? "DOCUMENT_DEFINITION_INACTIVE"
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
      : mappingRequired
        ? "활성화하려면 먼저 입력 설정을 완료해 주세요."
        : definitionDeleted
          ? "삭제된 문서 종류에는 템플릿을 등록할 수 없습니다."
          : definitionInactive
            ? "사용 중지된 문서 종류에는 템플릿을 등록할 수 없습니다."
            : "템플릿 등록에 실패했습니다. (단계: " + stage + ", 추적번호: " + correlationId + ")";
    return NextResponse.json(
      { error: message, errorCode, correlationId },
      {
        status: forbidden
          ? 403
          : mappingRequired || definitionInactive || definitionDeleted
            ? 409
            : 500,
      }
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
