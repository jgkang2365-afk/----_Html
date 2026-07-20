import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildDocumentOutputPath,
  DocumentType,
  isDocumentType,
  normalizeMeasurementPeriod,
} from "@/lib/document-generation/constants";
import { buildDocumentSnapshot } from "@/lib/document-generation/snapshot";

export const dynamic = "force-dynamic";

function outputRoot() {
  return process.env.DOCUMENT_OUTPUT_ROOT || "Z:\\data\\측정팀\\측정보고서";
}

async function getContext(businessId: number) {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from("document_generation_jobs")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  if (!job?.new_business_code_created) return { job: null, templates: [], outputPath: null };
  const period = normalizeMeasurementPeriod(job.measurement_period);
  const { data: templates, error: templateError } = await admin
    .from("document_templates")
    .select("*")
    .eq("measurement_year", job.measurement_year)
    .eq("measurement_period", period || "")
    .eq("is_active", true);
  if (templateError) throw templateError;
  const { target, snapshot } = await buildDocumentSnapshot(admin, businessId);
  return {
    job,
    templates: templates || [],
    snapshot,
    outputPath: buildDocumentOutputPath(
      outputRoot(),
      job.measurement_year,
      job.measurement_period,
      target.business_name,
      job.business_code
    ),
  };
}

export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const businessId = Number(new URL(request.url).searchParams.get("businessId"));
    if (!Number.isInteger(businessId))
      return NextResponse.json({ error: "사업장 ID가 필요합니다." }, { status: 400 });
    return NextResponse.json(await getContext(businessId));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "문서 생성 상태 조회 실패" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const user = await getUser();
    const { business_id, selected_documents } = await request.json();
    const businessId = Number(business_id);
    const selected = Array.isArray(selected_documents)
      ? (Array.from(new Set(selected_documents.filter(isDocumentType))) as DocumentType[])
      : [];
    if (!Number.isInteger(businessId))
      return NextResponse.json({ error: "저장된 사업장 ID가 필요합니다." }, { status: 400 });
    if (selected.length === 0)
      return NextResponse.json(
        { error: "생성할 문서를 하나 이상 선택해 주세요." },
        { status: 400 }
      );

    const admin = createAdminClient();
    const context = await getContext(businessId);
    if (!context.job)
      return NextResponse.json(
        { error: "신규 사업장 코드로 등록된 업체만 문서를 생성할 수 있습니다." },
        { status: 403 }
      );
    if (["PENDING", "PROCESSING"].includes(context.job.status))
      return NextResponse.json({ error: "이미 문서 생성 작업이 진행 중입니다." }, { status: 409 });
    if (context.job.status === "COMPLETED")
      return NextResponse.json({ error: "신규 문서 생성이 이미 완료되었습니다." }, { status: 409 });
    const templateMap = new Map(
      (context.templates || []).map((template: any) => [template.document_type, template])
    );
    if (selected.some((type) => !templateMap.has(type)))
      return NextResponse.json(
        { error: "선택한 문서 중 해당 연도·주기의 활성 템플릿이 없는 항목이 있습니다." },
        { status: 400 }
      );

    const { target, snapshot } = await buildDocumentSnapshot(admin, businessId);
    if (!target.business_name || !target.year || !target.period || !target.code)
      return NextResponse.json(
        { error: "문서 생성을 위해 사업장명, 측정연도, 측정주기를 입력하고 먼저 저장해 주세요." },
        { status: 400 }
      );
    const templates = Object.fromEntries(
      selected.map((type) => {
        const template: any = templateMap.get(type);
        return [
          type,
          {
            template_id: template.id,
            version: template.version,
            storage_path: template.storage_path,
            original_filename: template.original_filename,
            size_bytes: template.size_bytes,
            extension: template.extension,
            sha256: template.sha256,
          },
        ];
      })
    );
    const payload = {
      snapshot,
      templates,
      output_path: context.outputPath,
      selected_documents: selected,
      new_business_code_created: true,
    };
    const { data: queued, error } = await admin.rpc("queue_document_generation_job", {
      p_business_id: businessId,
      p_payload: payload,
      p_selected_documents: selected,
      p_requested_by: user ? Number(user.id) : null,
    });
    if (error) {
      if (String(error.message).includes("DOCUMENT_GENERATION_ALREADY_RUNNING"))
        return NextResponse.json(
          { error: "이미 문서 생성 작업이 진행 중입니다." },
          { status: 409 }
        );
      throw error;
    }
    return NextResponse.json({ success: true, job: queued, outputPath: context.outputPath });
  } catch (error: any) {
    console.error("[DocumentGeneration] 작업 등록 실패:", error?.message || error);
    return NextResponse.json(
      { error: error?.message || "문서 생성 요청에 실패했습니다." },
      { status: 500 }
    );
  }
}
