import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOCUMENT_SOURCE_FIELDS } from "../lib/document-generation/definitions";

test("문서 업종의 값 원천은 business_info이며 모든 source field에 원천 정보가 있다", () => {
  const fields = new Map(DOCUMENT_SOURCE_FIELDS.map((field) => [field.value, field.origin]));
  assert.equal(fields.get("business_category"), "business_info.business_category");
  assert.equal(fields.size, DOCUMENT_SOURCE_FIELDS.length);
  assert.ok(DOCUMENT_SOURCE_FIELDS.every((field) => field.origin.length > 0));
});

test("문서 정의 API는 source field 원천 메타데이터를 그대로 반환한다", () => {
  const route = readFileSync("app/api/document-definitions/route.ts", "utf8");
  assert.match(route, /source_fields:\s*DOCUMENT_SOURCE_FIELDS/);
});

test("분석표는 선택한 source field의 원천을 읽기 전용 열에 표시한다", () => {
  const management = readFileSync("components/features/DocumentTemplateManagement.tsx", "utf8");
  assert.match(management, /setFields\(responseRows<Field>\(result, \["source_fields"\]\)\)/);
  assert.match(management, /<th[^>]*>기본값<\/th><th[^>]*>값 원천<\/th><th[^>]*>상태<\/th>/);
  assert.match(management, /new Map\(fields\.map\(\(field\) => \[field\.value \|\| field\.code \|\| "", field\.origin \|\| ""\]\)\)/);
  assert.match(management, /fieldOriginByValue\.get\(mapping\.source_field\)/);
  assert.match(management, /title=\{origin\}><span className="block truncate">\{origin\}<\/span>/);
});
