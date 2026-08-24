import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DOCUMENT_SOURCE_FIELDS,
  parseDocumentDefinitionInput,
  parseDocumentFieldMappings,
  validateFilenamePattern,
} from "../lib/document-generation/definitions";
import { selectApplicableDefinitionTemplates } from "../lib/document-generation/template-selection";

test("문서 정의는 세 파일 형식과 서버 생성 code 계약을 사용한다", () => {
  for (const file_format of ["HWPX", "XLSX", "XLSM"] as const) {
    const input = parseDocumentDefinitionInput({
      name: `${file_format} 문서`,
      file_format,
      filename_pattern: "{business_name}-{short_year}{short_period}",
    });
    assert.equal(input.file_format, file_format);
    assert.equal(input.default_selected, true);
  }
  assert.throws(() => validateFilenamePattern("문서.xlsx"), /확장자/);
  assert.throws(() => validateFilenamePattern("{unknown}"), /지원하지 않는 파일명 변수/);

  const route = readFileSync("app/api/document-definitions/route.ts", "utf8");
  assert.match(route, /createDocumentCode\(\)/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /deleted_at: now/);
});

test("입력 매핑은 허용 필드, 대상 형식, A1 주소와 중복을 검증한다", () => {
  assert.ok(DOCUMENT_SOURCE_FIELDS.some((field) => field.value === "business_name"));
  assert.deepEqual(
    parseDocumentFieldMappings(
      [
        {
          source_field: "business_name",
          target_type: "EXCEL_CELL",
          target_sheet: "기본정보",
          target_address: "b2",
        },
      ],
      "XLSX"
    )[0],
    {
      source_field: "business_name",
      target_type: "EXCEL_CELL",
      target_sheet: "기본정보",
      target_address: "B2",
      required: false,
      default_value: null,
      sort_order: 0,
    }
  );
  assert.throws(
    () =>
      parseDocumentFieldMappings(
        [
          {
            source_field: "unsafe_sql",
            target_type: "HWPX_FIELD",
            target_address: "field",
          },
        ],
        "HWPX"
      ),
    /허용하지 않는 DB 필드/
  );
  assert.throws(
    () =>
      parseDocumentFieldMappings(
        [
          {
            source_field: "business_name",
            target_type: "EXCEL_CELL",
            target_sheet: "기본정보",
            target_address: "B0",
          },
        ],
        "XLSM"
      ),
    /A1 형식/
  );
  assert.throws(
    () =>
      parseDocumentFieldMappings(
        [
          {
            source_field: "business_name",
            target_type: "HWPX_FIELD",
            target_address: "business_name",
          },
          {
            source_field: "address",
            target_type: "HWPX_FIELD",
            target_address: "business_name",
          },
        ],
        "HWPX"
      ),
    /중복/
  );
});

test("HWPX 내부 제어 기본값은 서버 저장 입력에서 제거한다", () => {
  const [rawMapping, readableMapping] = parseDocumentFieldMappings(
    [
      {
        source_field: "measurement_year",
        target_type: "HWPX_FIELD",
        target_sheet: null,
        target_address: "measurement_year",
        required: true,
        default_value: "Clickhere:set:Direction:wstring:4:연도 HelpState:0",
        sort_order: 0,
      },
      {
        source_field: "business_name",
        target_type: "HWPX_FIELD",
        target_sheet: null,
        target_address: "business_name",
        required: false,
        default_value: "기본 사업장",
        sort_order: 1,
      },
    ],
    "HWPX"
  );

  assert.equal(rawMapping.default_value, null);
  assert.equal(readableMapping.default_value, "기본 사업장");
});

test("동적 템플릿 선택은 정의별 정확 주기를 annual보다 우선한다", () => {
  const selected = selectApplicableDefinitionTemplates(
    [
      {
        document_type: "CUSTOM",
        document_definition_id: "definition",
        measurement_year: 2026,
        measurement_period: "annual",
        is_active: true,
        id: "annual",
      },
      {
        document_type: "CUSTOM",
        document_definition_id: "definition",
        measurement_year: 2026,
        measurement_period: "하반기",
        is_active: true,
        id: "exact",
      },
      {
        document_type: "OTHER",
        document_definition_id: "other",
        measurement_year: 2025,
        measurement_period: "annual",
        is_active: true,
        id: "past",
      },
    ],
    2026,
    "하반기"
  );
  assert.equal((selected.get("definition") as any).id, "exact");
  assert.equal(selected.has("other"), false);
});

test("마이그레이션은 기존 3종과 매핑을 재실행 가능하게 이전한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260727_add_dynamic_document_definitions.sql",
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.document_definitions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.document_field_mappings/);
  assert.match(migration, /GENERAL_PRELIMINARY_SURVEY/);
  assert.match(migration, /FIELD_PRELIMINARY_SURVEY/);
  assert.match(migration, /MEASUREMENT_PLAN_XLSM/);
  assert.match(migration, /ON CONFLICT \(code\) DO NOTHING/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
  assert.match(migration, /document_definition_id UUID/);
  assert.match(migration, /replace_document_field_mappings/);
  assert.match(migration, /target_sheet IS NOT NULL/);
  assert.match(migration, /uq_document_templates_one_active/);
});

test("생성 요청은 정의, 템플릿, 매핑과 사업장 snapshot을 함께 고정한다", () => {
  const route = readFileSync("app/api/document-generation/route.ts", "utf8");
  const workerRoute = readFileSync(
    "app/api/document-worker/jobs/[id]/templates/[templateId]/route.ts",
    "utf8"
  );
  assert.match(route, /const documents = uniqueDefinitions\.map/);
  assert.match(route, /get_document_generation_catalog/);
  assert.match(route, /mappings: definition\.mappings/);
  assert.match(route, /selected_documents: selected/);
  assert.match(route, /snapshot,/);
  assert.match(workerRoute, /job\.payload as any\)\?\.documents/);
  assert.match(workerRoute, /snapshotDocument\.template\?\.storage_path/);
  assert.match(workerRoute, /payloadDocuments\.length > 0/);
});

test("템플릿 업로드는 기존 오류 계약과 HWPX 자동 분석·수동 매핑 경로를 함께 유지한다", () => {
  const route = readFileSync("app/api/document-templates/route.ts", "utf8");
  const management = readFileSync("components/features/DocumentTemplateManagement.tsx", "utf8");
  assert.match(route, /error\?\.code === "DOCUMENT_MAPPING_REQUIRED"/);
  assert.match(route, /error\?\.code === "DOCUMENT_DEFINITION_INACTIVE"/);
  assert.match(route, /mappingRequired \|\| definitionInactive \|\| definitionDeleted/);
  assert.match(management, /setSelectedId\(created\.id\)/);
  assert.match(management, /\/api\/document-templates\/analyze/);
  assert.match(management, /매핑 추가/);
  assert.match(management, /HWPX 누름틀 자동 분석 결과를 먼저 확인/);
  assert.match(management, /1 문서 선택 → 2 원본 선택 → 3 분석 → 4 문제 확인 → 5 최종 확인/);
});
