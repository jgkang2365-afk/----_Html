import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOCUMENT_SOURCE_FIELDS } from "../lib/document-generation/definitions";
import { buildDocumentSnapshot } from "../lib/document-generation/snapshot";

function mockClient(
  plan: { recommended_date: string | null; participant_names: unknown } | null,
  legacySurveyor: string | null = null
) {
  const selected: Record<string, string> = {};
  const supabase = {
    from(table: string) {
      const query = {
        select(columns: string) {
          selected[table] = columns;
          return query;
        },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          if (table === "measurement_target_business") return {
            data: { id: 7, code: "H0001", year: 2026, period: "하반기", business_name: "테스트 사업장", business_category: "공업사", office_jurisdiction: null },
            error: null,
          };
          if (table === "business_info") return { data: { business_category: "제조업" }, error: null };
          if (table === "preliminary_survey") return {
            data: { preliminary_surveyor: legacySurveyor, measurement_date: "2026-09-01" },
            error: null,
          };
          if (table === "preliminary_survey_v2_plans") return { data: plan, error: null };
          throw new Error(`Unexpected table: ${table}`);
        },
      };
      return query;
    },
  };
  return { supabase, selected };
}

test("V2 recommended_date와 participant_names를 문서 표시값으로 변환한다", async () => {
  const client = mockClient({ recommended_date: "2026-10-16", participant_names: ["이태환", "강종구"] });
  const { snapshot } = await buildDocumentSnapshot(client.supabase, 7);
  assert.deepEqual(
    [snapshot.preliminary_survey_year, snapshot.preliminary_survey_month,
      snapshot.preliminary_survey_day, snapshot.preliminary_surveyor],
    ["2026", "10", "16", "이 태 환, 강 종 구"]
  );
  assert.equal(client.selected.preliminary_survey_v2_plans, "recommended_date, participant_names");
});

test("V2 날짜가 없으면 legacy 측정일을 조회하거나 fallback하지 않는다", async () => {
  const client = mockClient({ recommended_date: null, participant_names: [] }, "이태환, 강종구");
  const { snapshot } = await buildDocumentSnapshot(client.supabase, 7);
  assert.deepEqual(
    [snapshot.preliminary_survey_year, snapshot.preliminary_survey_month, snapshot.preliminary_survey_day],
    ["", "", ""]
  );
  assert.equal(client.selected.preliminary_survey, "preliminary_surveyor");
  assert.doesNotMatch(JSON.stringify(client.selected), /measurement_date/);
  assert.equal(snapshot.preliminary_surveyor, "이 태 환, 강 종 구");
});

test("예비조사 날짜의 월일 선행 0을 유지하고 혼합 이름은 문자 단위로 분해하지 않는다", async () => {
  const client = mockClient({ recommended_date: "2026-09-08", participant_names: ["이 태 환", "John   Kim", "김 A"] });
  const { snapshot } = await buildDocumentSnapshot(client.supabase, 7);
  assert.deepEqual(
    [snapshot.preliminary_survey_year, snapshot.preliminary_survey_month, snapshot.preliminary_survey_day],
    ["2026", "09", "08"]
  );
  assert.equal(snapshot.preliminary_surveyor, "이 태 환, John Kim, 김 A");
});

test("잘못된 형식의 예비조사 날짜는 빈 문자열로 유지한다", async () => {
  const client = mockClient({ recommended_date: "2026/09/08", participant_names: [] });
  const { snapshot } = await buildDocumentSnapshot(client.supabase, 7);
  assert.deepEqual(
    [snapshot.preliminary_survey_year, snapshot.preliminary_survey_month, snapshot.preliminary_survey_day],
    ["", "", ""]
  );
});

test("source-field CHECK는 예비조사 날짜 세 필드를 허용하고 mapping 행은 만들지 않는다", () => {
  const migration = readFileSync("supabase/migrations/20261004080000_document_preliminary_survey_fields.sql", "utf8");
  const check = migration.match(/source_field IN \(([\s\S]*?)\)/)?.[1] ?? "";
  const fields = [...check.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(new Set(fields), new Set(DOCUMENT_SOURCE_FIELDS.map(({ value }) => value)));
  assert.doesNotMatch(migration, /\b(?:INSERT|UPSERT|UPDATE|DELETE)\b/i);
});
