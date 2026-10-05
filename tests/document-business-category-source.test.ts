import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GENERAL_PRELIMINARY_SURVEY_CODE,
  INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_CODE,
  isDocumentDefinitionEligibleForTarget,
} from "../lib/document-generation/business-eligibility";
import { buildDocumentSnapshot } from "../lib/document-generation/snapshot";

function mockClient(targetCategory: string, infoCategory: string | null) {
  const target = {
    id: 7,
    code: "H0001",
    year: 2026,
    period: "하반기",
    business_name: "테스트 사업장",
    business_category: targetCategory,
    business_type: "first_measurement",
    document_generation_enabled: true,
    office_jurisdiction: null,
  };
  let businessInfoSelect = "";
  const supabase = {
    from(table: string) {
      const query = {
        select(columns: string) {
          if (table === "business_info") businessInfoSelect = columns;
          return query;
        },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          if (table === "measurement_target_business") return { data: target, error: null };
          if (table === "business_info")
            return { data: { invoice_email: null, main_product: null, business_category: infoCategory }, error: null };
          if (table === "preliminary_survey") return { data: null, error: null };
          if (table === "preliminary_survey_v2_plans") return { data: null, error: null };
          throw new Error(`Unexpected table: ${table}`);
        },
      };
      return query;
    },
  };
  return { supabase, target, getBusinessInfoSelect: () => businessInfoSelect };
}

test("문서 업종은 business_info, 예비조사표 판정은 측정대상 업종을 사용한다", async () => {
  for (const [targetCategory, infoCategory, expectedIndustrial] of [
    ["공업사", "제조업", true],
    ["제조업", "공업사", false],
  ] as const) {
    const client = mockClient(targetCategory, infoCategory);
    const { target, snapshot } = await buildDocumentSnapshot(client.supabase, 7);
    assert.match(client.getBusinessInfoSelect(), /\bbusiness_category\b/);
    assert.equal(snapshot.business_category, infoCategory);
    assert.equal(target.business_category, targetCategory);
    assert.equal(
      isDocumentDefinitionEligibleForTarget({ code: INDUSTRIAL_SHOP_PRELIMINARY_SURVEY_CODE }, target),
      expectedIndustrial
    );
    assert.equal(
      isDocumentDefinitionEligibleForTarget({ code: GENERAL_PRELIMINARY_SURVEY_CODE }, target),
      !expectedIndustrial
    );
  }
});

test("business_info 업종이 NULL 또는 공란이면 문서 업종을 비워 둔다", async () => {
  for (const infoCategory of [null, "", "   "]) {
    const client = mockClient("공업사", infoCategory);
    const { snapshot } = await buildDocumentSnapshot(client.supabase, 7);
    assert.equal(snapshot.business_category, "");
  }
});

test("API의 예외 경로는 문서 snapshot 대신 측정대상 업종으로 양식 종류를 재검증한다", () => {
  const route = readFileSync("app/api/document-generation/route.ts", "utf8");
  assert.match(route, /targetBusinessCategory: target\.business_category/);
  assert.match(
    route,
    /isPreliminarySurveyVariantEligibleForTarget\(definition, \{\s*business_category: context\.targetBusinessCategory,\s*\}\)/
  );
  assert.doesNotMatch(route, /isPreliminarySurveyVariantEligibleForTarget\(definition, context\.snapshot/);
});
