import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ANNUAL_TEMPLATE_PERIOD,
  buildDocumentOutputPath,
  normalizeMeasurementPeriod,
} from "@/lib/document-generation/constants";
import { buildDocumentSnapshot } from "@/lib/document-generation/snapshot";
import {
  DOCUMENT_GENERATION_JOURNAL_ERROR,
  findActualMeasurementJournal,
} from "@/lib/document-generation/journal";
import {
  selectApplicableDefinitionTemplates,
  selectApplicableDocumentTemplates,
} from "@/lib/document-generation/template-selection";
import { isDocumentDefinitionVisibleForJurisdiction } from "@/lib/document-generation/selection-report-visibility";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function outputRoot() {
  return process.env.DOCUMENT_OUTPUT_ROOT || "Z:\\data\\측정팀\\측정보고서";
}

async function getContext(businessId: number) {
  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("measurement_target_business")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("DOCUMENT_TARGET_NOT_FOUND");

  const { data: businessInfo, error: businessInfoError } = await admin
    .from("business_info")
    .select("office_jurisdiction")
    .eq("code", target.code)
    .maybeSingle();
  if (businessInfoError) throw businessInfoError;
  const officeJurisdiction = String(businessInfo?.office_jurisdiction ?? "").trim();

  const eligible = target.document_generation_enabled === true;
  const period = normalizeMeasurementPeriod(target.period);
  const actualJournal = await findActualMeasurementJournal(admin, target);
  const { data: jobRows, error } = await admin
    .from("document_generation_jobs")
    .select(
      "id, status, selected_documents, error_message, result_files, requested_at, started_at, completed_at, updated_at, worker_id, attempt_count, created_at"
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const job = jobRows?.[0] || null;

  if (!eligible || actualJournal) {
    return {
      eligible,
      hasActualMeasurementJournal: Boolean(actualJournal),
      job,
      templates: [],
      documents: [],
      outputPath: null,
      measurementYear: target.year,
      measurementPeriod: period,
    };
  }

  if (!period) throw new Error("지원하지 않는 측정주기입니다.");
  const { data: templateCandidates, error: templateError } = await admin
    .from("document_templates")
    .select("*")
    .eq("measurement_year", target.year)
    .in("measurement_period", [period, ANNUAL_TEMPLATE_PERIOD])
    .eq("is_active", true);
  if (templateError) throw templateError;
  // 기존 3종 선택 규칙의 회귀 기준도 같은 후보 집합에서 계속 검증한다.
  selectApplicableDocumentTemplates(templateCandidates || [], target.year, period);
  const selectedTemplateMap = selectApplicableDefinitionTemplates(
    templateCandidates || [],
    target.year,
    period
  );
  const { data: definitions, error: definitionsError } = await admin
    .from("document_definitions")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");
  if (definitionsError) throw definitionsError;
  const applicableDefinitions = (definitions || []).filter(
    (definition: any) =>
      isDocumentDefinitionVisibleForJurisdiction(definition.name, officeJurisdiction)
  );
  const documents = applicableDefinitions.map((definition: any) => {
    const template: any = selectedTemplateMap.get(definition.id) || null;
    return {
      document_definition_id: definition.id,
      code: definition.code,
      name: definition.name,
      file_format: definition.file_format,
      filename_pattern: definition.filename_pattern,
      default_selected: definition.default_selected,
      sort_order: definition.sort_order,
      available: Boolean(template),
      unavailable_reason: template
        ? null
        : `${target.year}년 ${period}에 적용 가능한 활성 양식이 없습니다.`,
      template: template
        ? {
            template_id: template.id,
            version: template.version,
            original_filename: template.original_filename,
            storage_path: template.storage_path,
            size_bytes: template.size_bytes,
            sha256: template.sha256,
            extension: template.extension,
            measurement_year: template.measurement_year,
            measurement_period: template.measurement_period,
            is_annual: template.measurement_period === ANNUAL_TEMPLATE_PERIOD,
          }
        : null,
    };
  });
  const templates = Array.from(selectedTemplateMap.values());
  const { snapshot } = await buildDocumentSnapshot(admin, businessId);
  return {
    eligible,
    hasActualMeasurementJournal: false,
    job,
    templates,
    documents,
    snapshot,
    measurementYear: target.year,
    measurementPeriod: period,
    outputPath: buildDocumentOutputPath(
      outputRoot(),
      target.year,
      target.period,
      target.business_name,
      target.code
    ),
  };
}

export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const businessId = Number(new URL(request.url).searchParams.get("businessId"));
    if (!Number.isInteger(businessId))
      return NextResponse.json({ error: "사업장 ID가 필요합니다." }, { status: 400 });
    return NextResponse.json(await getContext(businessId), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
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
    const requestedDocuments = Array.isArray(selected_documents)
      ? Array.from(
          new Set(
            selected_documents.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
          )
        )
      : [];
    if (!Number.isInteger(businessId))
      return NextResponse.json({ error: "저장된 사업장 ID가 필요합니다." }, { status: 400 });
    if (requestedDocuments.length === 0)
      return NextResponse.json(
        { error: "생성할 문서를 하나 이상 선택해 주세요." },
        { status: 400 }
      );

    const admin = createAdminClient();
    const context = await getContext(businessId);
    if (!context.eligible)
      return NextResponse.json(
        { error: "문서 생성 자격이 없는 측정대상사업장입니다." },
        { status: 403 }
      );
    if (context.hasActualMeasurementJournal)
      return NextResponse.json({ error: DOCUMENT_GENERATION_JOURNAL_ERROR }, { status: 409 });
    if (context.job && ["PENDING", "PROCESSING"].includes(context.job.status))
      return NextResponse.json({ error: "이미 문서 생성 작업이 진행 중입니다." }, { status: 409 });
    const documentMap = new Map<string, any>();
    for (const document of context.documents || []) {
      documentMap.set(document.code, document);
      documentMap.set(document.document_definition_id, document);
    }
    const selectedDefinitions = requestedDocuments.map((value) => documentMap.get(value));
    if (selectedDefinitions.some((definition) => !definition?.available))
      return NextResponse.json(
        {
          error: `선택한 문서 중 ${context.measurementYear}년 ${context.measurementPeriod}에 적용 가능한 활성 양식이 없는 항목이 있습니다.`,
        },
        { status: 400 }
      );
    const uniqueDefinitions = Array.from(
      new Map(
        selectedDefinitions.map((definition) => [definition.document_definition_id, definition])
      ).values()
    );
    if (uniqueDefinitions.length !== requestedDocuments.length)
      return NextResponse.json({ error: "같은 문서를 중복 선택할 수 없습니다." }, { status: 400 });
    const selected = uniqueDefinitions.map((definition) => definition.code);

    const { target, snapshot } = await buildDocumentSnapshot(admin, businessId);
    if (!target.business_name || !target.year || !target.period || !target.code)
      return NextResponse.json(
        { error: "문서 생성을 위해 사업장명, 측정연도, 측정주기를 입력하고 먼저 저장해 주세요." },
        { status: 400 }
      );
    const definitionIds = uniqueDefinitions.map((definition) => definition.document_definition_id);
    const { data: mappingRows, error: mappingError } = await admin
      .from("document_field_mappings")
      .select("*")
      .in("document_definition_id", definitionIds)
      .order("sort_order")
      .order("created_at");
    if (mappingError) throw mappingError;
    const mappingsByDefinition = new Map<string, any[]>();
    for (const mapping of mappingRows || []) {
      const current = mappingsByDefinition.get(mapping.document_definition_id) || [];
      current.push({
        source_field: mapping.source_field,
        target_type: mapping.target_type,
        target_sheet: mapping.target_sheet,
        target_address: mapping.target_address,
        required: mapping.required,
        default_value: mapping.default_value,
        sort_order: mapping.sort_order,
      });
      mappingsByDefinition.set(mapping.document_definition_id, current);
    }
    const templates = Object.fromEntries(
      uniqueDefinitions.map((definition) => {
        const template: any = definition.template;
        return [
          definition.code,
          {
            template_id: template.template_id,
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
    const documents = uniqueDefinitions.map((definition) => {
      const template = definition.template;
      return {
        document_definition_id: definition.document_definition_id,
        code: definition.code,
        name: definition.name,
        file_format: definition.file_format,
        filename_pattern: definition.filename_pattern,
        template: {
          template_id: template.template_id,
          version: template.version,
          original_filename: template.original_filename,
          storage_path: template.storage_path,
          size_bytes: template.size_bytes,
          sha256: template.sha256,
          extension: template.extension,
          measurement_year: template.measurement_year,
          measurement_period: template.measurement_period,
        },
        mappings: mappingsByDefinition.get(definition.document_definition_id) || [],
      };
    });
    const payload = {
      snapshot,
      templates,
      documents,
      output_path: context.outputPath,
      selected_documents: selected,
      document_generation_enabled: true,
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
      if (String(error.message).includes("DOCUMENT_GENERATION_JOURNAL_EXISTS"))
        return NextResponse.json({ error: DOCUMENT_GENERATION_JOURNAL_ERROR }, { status: 409 });
      if (String(error.message).includes("DOCUMENT_GENERATION_NOT_ELIGIBLE"))
        return NextResponse.json(
          { error: "문서 생성 자격이 없는 측정대상사업장입니다." },
          { status: 403 }
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
