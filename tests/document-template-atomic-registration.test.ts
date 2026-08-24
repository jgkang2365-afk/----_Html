import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20260824090000_atomic_hwpx_registration_and_definition_soft_delete.sql";

test("HWPX 분석 확인은 pending 상태만 확정하고 운영 매핑 API를 호출하지 않는다", () => {
  const ui = readFileSync("components/features/DocumentTemplateManagement.tsx", "utf8");
  const analysisBranch = ui.slice(
    ui.indexOf('if (mappingMode === "analysis")'),
    ui.indexOf("setSaving(true)", ui.indexOf('if (mappingMode === "analysis")'))
  );
  assert.match(analysisBranch, /setPendingMappings/);
  assert.match(analysisBranch, /setConfirmedAnalysisFile/);
  assert.doesNotMatch(analysisBranch, /\/api\/document-definitions\/.*\/mappings/);
  assert.match(ui, /body\.set\(\s*"mappings"/);
  assert.match(ui, /분석 결과 확인/);
});

test("문서 종류 선택부터 분석·미리보기·등록 완료까지 한 화면 흐름을 유지한다", () => {
  const ui = readFileSync("components/features/DocumentTemplateManagement.tsx", "utf8");
  assert.match(ui, /selectDefinition\(definition\.id, true\)/);
  assert.match(ui, /현재 분석 결과가 저장되지 않았습니다/);
  assert.match(ui, /3\. 누름틀 분석/);
  assert.match(ui, /등록할 템플릿 최종 확인/);
  assert.match(ui, /분석 확인/);
  assert.doesNotMatch(ui, />매핑 미리보기</);
  assert.match(ui, /기존 템플릿 \/ 등록 이력/);
  assert.match(ui, /sanitizeHwpxDefaultValue\(mapping\.default_value\)/);
  assert.match(ui, /analysisReview\.issue_mappings/);
  assert.match(ui, /!analysisReview\.can_register/);
  assert.match(ui, /form="template-upload-form"/);
  assert.match(ui, /등록 완료/);
  assert.match(ui, /sticky top-0/);
  assert.match(ui, /!definition\.deleted_at && definition\.is_active/);
  assert.doesNotMatch(ui, /공업사.*selectedId|selectedId.*공업사/);
});

test("HWPX 최종 등록은 Storage staging 후 단일 RPC로 템플릿과 매핑을 확정한다", () => {
  const route = readFileSync("app/api/document-templates/route.ts", "utf8");
  const upload = route.indexOf('stage = "STORAGE_UPLOAD"');
  const finalize = route.indexOf('stage = "ATOMIC_FINALIZE"');
  assert.ok(upload >= 0 && finalize > upload);
  assert.match(route, /finalize_hwpx_document_template/);
  assert.match(route, /storage\.from\("document-templates"\)\.remove\(\[uploadedPath\]\)/);
});

test("최종 등록 RPC는 definition 잠금 아래 템플릿·매핑·활성화를 한 transaction으로 수행한다", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.finalize_hwpx_document_template");
  const end = sql.indexOf("CREATE OR REPLACE FUNCTION public.get_document_generation_catalog");
  const rpc = sql.slice(start, end);
  assert.match(rpc, /FROM public\.document_definitions[\s\S]*FOR UPDATE/);
  assert.match(rpc, /DOCUMENT_DEFINITION_DELETED/);
  assert.match(rpc, /INSERT INTO public\.document_templates/);
  assert.match(rpc, /DELETE FROM public\.document_field_mappings/);
  assert.match(rpc, /INSERT INTO public\.document_field_mappings/);
  assert.match(rpc, /SET is_active = FALSE/);
  assert.match(rpc, /SET is_active = TRUE/);
  assert.match(sql, /replace_document_field_mappings[\s\S]*DOCUMENT_DEFINITION_DELETED/);
});

test("생성 catalog는 삭제되지 않은 정의의 템플릿과 매핑을 단일 statement snapshot으로 반환한다", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const catalog = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.get_document_generation_catalog")
  );
  assert.match(
    catalog,
    /RETURNS TABLE\(document_definition JSONB, template JSONB, mappings JSONB\)/
  );
  assert.match(catalog, /definition\.deleted_at IS NULL/);
  assert.match(catalog, /definition\.is_active = TRUE/);
  assert.match(catalog, /public\.document_field_mappings/);
  assert.match(catalog, /public\.document_templates/);
});

test("문서 종류 삭제·복구는 definition만 갱신하고 연관 이력을 삭제하지 않는다", () => {
  const route = readFileSync("app/api/document-definitions/route.ts", "utf8");
  const deletion = route.slice(route.indexOf("export async function DELETE"));
  assert.match(deletion, /deleted_at: now/);
  assert.match(deletion, /is_active: false/);
  assert.doesNotMatch(deletion, /from\("document_templates"\)\.delete/);
  assert.doesNotMatch(deletion, /from\("document_field_mappings"\)\.delete/);
  assert.doesNotMatch(deletion, /from\("document_generation_jobs"\)\.delete/);
  assert.match(route, /restore === true/);
  assert.match(route, /deleted_at: null/);
});

test("삭제 definition은 직접 생성과 분석·최종등록에서 모두 차단된다", () => {
  const generation = readFileSync("app/api/document-generation/route.ts", "utf8");
  const analyze = readFileSync("app/api/document-templates/analyze/route.ts", "utf8");
  const upload = readFileSync("app/api/document-templates/route.ts", "utf8");
  assert.match(generation, /DOCUMENT_DEFINITION_DELETED/);
  assert.match(generation, /status: 409/);
  assert.match(analyze, /DEFINITION_DELETED/);
  assert.match(upload, /DOCUMENT_DEFINITION_DELETED/);
});
