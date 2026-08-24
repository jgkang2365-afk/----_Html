import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  analyzeHwpxPlaceholders,
  HwpxAnalysisError,
} from "@/lib/document-generation/hwpx-placeholder-analysis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const form = await request.formData();
    const file = form.get("file");
    const definitionId = String(form.get("document_definition_id") ?? "").trim();
    if (!definitionId || !isUploadedFile(file))
      return NextResponse.json(
        { error: "문서 종류와 분석할 HWPX 파일이 필요합니다.", errorCode: "INVALID_REQUEST" },
        { status: 400 }
      );
    if (!file.name.toLowerCase().endsWith(".hwpx"))
      return NextResponse.json(
        { error: "HWPX 파일만 자동 분석할 수 있습니다.", errorCode: "INVALID_HWPX" },
        { status: 400 }
      );
    if (file.size <= 0 || file.size > MAX_TEMPLATE_BYTES)
      return NextResponse.json(
        {
          error: "빈 파일이거나 템플릿 최대 크기(100MB)를 초과했습니다.",
          errorCode: "HWPX_TOO_LARGE",
        },
        { status: 400 }
      );

    const admin = createAdminClient();
    const { data: definition, error: definitionError } = await admin
      .from("document_definitions")
      .select("id, file_format, is_active, deleted_at")
      .eq("id", definitionId)
      .maybeSingle();
    if (definitionError) throw definitionError;
    if (!definition)
      return NextResponse.json(
        { error: "문서 종류를 찾을 수 없습니다.", errorCode: "DEFINITION_NOT_FOUND" },
        { status: 404 }
      );
    if (definition.deleted_at)
      return NextResponse.json(
        { error: "삭제된 문서 종류는 분석할 수 없습니다.", errorCode: "DEFINITION_DELETED" },
        { status: 409 }
      );
    if (definition.file_format !== "HWPX")
      return NextResponse.json(
        { error: "HWPX 문서 종류에서만 누름틀을 분석할 수 있습니다.", errorCode: "INVALID_HWPX" },
        { status: 400 }
      );

    const bytes = Buffer.from(await file.arrayBuffer());
    return NextResponse.json({ success: true, ...(await analyzeHwpxPlaceholders(bytes)) });
  } catch (error: unknown) {
    const forbidden = error instanceof Error && error.message === "ADMIN_REQUIRED";
    if (error instanceof HwpxAnalysisError)
      return NextResponse.json(
        { error: error.message, errorCode: error.code },
        { status: error.code === "NO_PLACEHOLDERS" ? 422 : 400 }
      );
    console.error("[DocumentTemplates] HWPX 분석 실패:", error);
    return NextResponse.json(
      {
        error: forbidden
          ? "관리자만 HWPX 템플릿을 분석할 수 있습니다."
          : "HWPX 분석에 실패했습니다.",
        errorCode: forbidden ? "DOCUMENT_TEMPLATE_ADMIN_REQUIRED" : "HWPX_ANALYSIS_FAILED",
      },
      { status: forbidden ? 403 : 500 }
    );
  }
}
