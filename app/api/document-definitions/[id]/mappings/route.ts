import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DOCUMENT_SOURCE_FIELDS,
  DocumentFileFormat,
  parseDocumentFieldMappings,
} from "@/lib/document-generation/definitions";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getUser();
  if (!user || user.role !== "관리자") throw new Error("ADMIN_REQUIRED");
}

async function getDefinition(admin: any, id: string) {
  const { data, error } = await admin
    .from("document_definitions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getMappings(admin: any, id: string) {
  const { data, error } = await admin
    .from("document_field_mappings")
    .select("*")
    .eq("document_definition_id", id)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return data || [];
}

function failure(error: any, fallback: string) {
  const forbidden = error?.message === "ADMIN_REQUIRED";
  return NextResponse.json(
    { error: forbidden ? "관리자만 접근할 수 있습니다." : error?.message || fallback },
    { status: forbidden ? 403 : error?.code ? 500 : 400 }
  );
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const definition = await getDefinition(admin, params.id);
    if (!definition)
      return NextResponse.json({ error: "문서 종류를 찾을 수 없습니다." }, { status: 404 });
    if (definition.deleted_at)
      return NextResponse.json(
        { error: "삭제된 문서 종류의 입력 설정은 변경할 수 없습니다." },
        { status: 409 }
      );
    return NextResponse.json({
      definition,
      mappings: await getMappings(admin, params.id),
      source_fields: DOCUMENT_SOURCE_FIELDS,
    });
  } catch (error: any) {
    return failure(error, "입력 매핑 조회에 실패했습니다.");
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const definition = await getDefinition(admin, params.id);
    if (!definition)
      return NextResponse.json({ error: "문서 종류를 찾을 수 없습니다." }, { status: 404 });
    if (definition.deleted_at)
      return NextResponse.json(
        { error: "삭제된 문서 종류의 입력 설정은 변경할 수 없습니다." },
        { status: 409 }
      );
    const body = await request.json();
    const mappings = parseDocumentFieldMappings(
      body?.mappings,
      definition.file_format as DocumentFileFormat
    );
    if (definition.file_format === "HWPX" && mappings.length === 0) {
      const { count, error } = await admin
        .from("document_templates")
        .select("id", { count: "exact", head: true })
        .eq("document_definition_id", params.id)
        .eq("is_active", true);
      if (error) throw error;
      if ((count || 0) > 0)
        return NextResponse.json(
          { error: "활성 HWPX 템플릿이 있는 문서는 누름틀 매핑을 비울 수 없습니다." },
          { status: 409 }
        );
    }
    const { error } = await admin.rpc("replace_document_field_mappings", {
      p_document_definition_id: params.id,
      p_mappings: mappings,
    });
    if (error) throw error;
    return NextResponse.json({
      success: true,
      definition,
      mappings: await getMappings(admin, params.id),
      source_fields: DOCUMENT_SOURCE_FIELDS,
    });
  } catch (error: any) {
    return failure(error, "입력 매핑 저장에 실패했습니다.");
  }
}
