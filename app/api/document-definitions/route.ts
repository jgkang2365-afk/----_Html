import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createDocumentCode,
  DOCUMENT_SOURCE_FIELDS,
  parseDocumentDefinitionInput,
} from "@/lib/document-generation/definitions";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getUser();
  if (!user || user.role !== "관리자") throw new Error("ADMIN_REQUIRED");
  return user;
}

function errorResponse(error: any, fallback: string) {
  const forbidden = error?.message === "ADMIN_REQUIRED";
  const validation =
    !forbidden && typeof error?.message === "string" && !error?.code && !error?.details;
  return NextResponse.json(
    {
      error: forbidden ? "관리자만 접근할 수 있습니다." : validation ? error.message : fallback,
    },
    { status: forbidden ? 403 : validation ? 400 : 500 }
  );
}

async function listDefinitions(admin: any, includeDeleted = false) {
  let definitionQuery = admin
    .from("document_definitions")
    .select("*")
    .order("sort_order")
    .order("created_at");
  if (!includeDeleted) definitionQuery = definitionQuery.is("deleted_at", null);
  const [definitionResult, mappingResult, templateResult] = await Promise.all([
    definitionQuery,
    admin.from("document_field_mappings").select("document_definition_id"),
    admin.from("document_templates").select("document_definition_id"),
  ]);
  if (definitionResult.error) throw definitionResult.error;
  if (mappingResult.error) throw mappingResult.error;
  if (templateResult.error) throw templateResult.error;
  const definitions = definitionResult.data;
  const mappings = mappingResult.data;
  const templates = templateResult.data;
  const mappingCounts = new Map<string, number>();
  const templateCounts = new Map<string, number>();
  for (const row of mappings || [])
    mappingCounts.set(
      row.document_definition_id,
      (mappingCounts.get(row.document_definition_id) || 0) + 1
    );
  for (const row of templates || [])
    templateCounts.set(
      row.document_definition_id,
      (templateCounts.get(row.document_definition_id) || 0) + 1
    );
  return (definitions || []).map((definition: any) => ({
    ...definition,
    mapping_count: mappingCounts.get(definition.id) || 0,
    template_count: templateCounts.get(definition.id) || 0,
  }));
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const includeDeleted = new URL(request.url).searchParams.get("include_deleted") === "true";
    const definitions = await listDefinitions(createAdminClient(), includeDeleted);
    return NextResponse.json({
      definitions,
      source_fields: DOCUMENT_SOURCE_FIELDS,
    });
  } catch (error: any) {
    return errorResponse(error, "문서 종류 조회에 실패했습니다.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin();
    const input = parseDocumentDefinitionInput(await request.json());
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("document_definitions")
      .insert({
        code: createDocumentCode(),
        ...input,
        created_by: Number(user.id),
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({
      success: true,
      definition: { ...data, mapping_count: 0, template_count: 0 },
    });
  } catch (error: any) {
    return errorResponse(error, "문서 종류 추가에 실패했습니다.");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json();
    const id = String(body?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "문서 종류 ID가 필요합니다." }, { status: 400 });
    if ("code" in body)
      return NextResponse.json({ error: "문서 code는 변경할 수 없습니다." }, { status: 400 });

    const admin = createAdminClient();
    const { data: current, error: currentError } = await admin
      .from("document_definitions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current)
      return NextResponse.json({ error: "문서 종류를 찾을 수 없습니다." }, { status: 404 });
    if (body?.restore === true) {
      if (!current.deleted_at) return NextResponse.json({ success: true, definition: current });
      const { data, error } = await admin
        .from("document_definitions")
        .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .not("deleted_at", "is", null)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ success: true, definition: data });
    }
    if (current.deleted_at)
      return NextResponse.json(
        { error: "삭제된 문서 종류는 복구한 뒤 수정할 수 있습니다." },
        { status: 409 }
      );

    const input = parseDocumentDefinitionInput(body, current);
    if (input.file_format !== current.file_format) {
      const [templateResult, mappingResult] = await Promise.all([
        admin
          .from("document_templates")
          .select("id", { count: "exact", head: true })
          .eq("document_definition_id", id),
        admin
          .from("document_field_mappings")
          .select("id", { count: "exact", head: true })
          .eq("document_definition_id", id),
      ]);
      if (templateResult.error) throw templateResult.error;
      if (mappingResult.error) throw mappingResult.error;
      if ((templateResult.count || 0) > 0)
        return NextResponse.json(
          {
            error:
              "템플릿이 등록된 문서는 파일 형식을 변경할 수 없습니다. 새 문서 종류를 추가해 주세요.",
          },
          { status: 409 }
        );
      if ((mappingResult.count || 0) > 0)
        return NextResponse.json(
          { error: "입력 매핑을 먼저 비운 뒤 파일 형식을 변경해 주세요." },
          { status: 409 }
        );
    }

    const { data, error } = await admin
      .from("document_definitions")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, definition: data });
  } catch (error: any) {
    return errorResponse(error, "문서 종류 수정에 실패했습니다.");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAdmin();
    const id = String((await request.json())?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "문서 종류 ID가 필요합니다." }, { status: 400 });
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("document_definitions")
      .update({
        deleted_at: now,
        deleted_by: Number(user.id),
        is_active: false,
        updated_at: now,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        { error: "문서 종류를 찾을 수 없거나 이미 삭제되었습니다." },
        { status: 404 }
      );
    return NextResponse.json({ success: true, definition: data });
  } catch (error: any) {
    return errorResponse(error, "문서 종류 삭제에 실패했습니다.");
  }
}
