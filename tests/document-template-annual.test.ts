import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ANNUAL_TEMPLATE_PERIOD,
  parseTemplateMeasurementPeriod,
  templateMeasurementPeriodLabel,
} from "../lib/document-generation/constants";
import {
  isTemplatePeriodApplicable,
  selectApplicableDocumentTemplates,
} from "../lib/document-generation/template-selection";

function template(id: string, documentType: string, year: number, period: string, active = true) {
  return {
    id,
    document_type: documentType,
    measurement_year: year,
    measurement_period: period,
    is_active: active,
  };
}

test("연간 공통 저장값과 표시명을 하나로 유지한다", () => {
  assert.equal(ANNUAL_TEMPLATE_PERIOD, "annual");
  assert.equal(parseTemplateMeasurementPeriod("annual"), "annual");
  assert.equal(templateMeasurementPeriodLabel("annual"), "연간 공통");
  assert.equal(parseTemplateMeasurementPeriod("연간 공통"), null);
  assert.equal(parseTemplateMeasurementPeriod("1"), null);
});

test("상반기 전용 양식은 같은 연도 annual보다 우선한다", () => {
  const selected = selectApplicableDocumentTemplates(
    [
      template("annual", "GENERAL_PRELIMINARY_SURVEY", 2026, "annual"),
      template("exact", "GENERAL_PRELIMINARY_SURVEY", 2026, "상반기"),
    ],
    2026,
    "상반기"
  );
  assert.equal(selected[0]?.id, "exact");
});

test("하반기 전용 양식은 같은 연도 annual보다 우선한다", () => {
  const selected = selectApplicableDocumentTemplates(
    [
      template("annual", "FIELD_PRELIMINARY_SURVEY", 2026, "annual"),
      template("exact", "FIELD_PRELIMINARY_SURVEY", 2026, "하반기"),
    ],
    2026,
    "하반기"
  );
  assert.equal(selected[0]?.id, "exact");
});

test("정확 주기가 없으면 같은 연도의 annual을 선택한다", () => {
  const selected = selectApplicableDocumentTemplates(
    [template("annual", "MEASUREMENT_PLAN_XLSM", 2026, "annual")],
    2026,
    "하반기"
  );
  assert.equal(selected[0]?.id, "annual");
});

test("다른 연도·다른 주기·비활성 양식은 자동 대체하지 않는다", () => {
  const selected = selectApplicableDocumentTemplates(
    [
      template("past-annual", "GENERAL_PRELIMINARY_SURVEY", 2026, "annual"),
      template("other-period", "FIELD_PRELIMINARY_SURVEY", 2027, "하반기"),
      template("inactive", "MEASUREMENT_PLAN_XLSM", 2027, "annual", false),
    ],
    2027,
    "상반기"
  );
  assert.deepEqual(selected, []);
});

test("Worker 주기 검증은 정확 주기와 annual만 허용한다", () => {
  assert.equal(isTemplatePeriodApplicable("상반기", "상반기"), true);
  assert.equal(isTemplatePeriodApplicable("annual", "상반기"), true);
  assert.equal(isTemplatePeriodApplicable("annual", "하반기"), true);
  assert.equal(isTemplatePeriodApplicable("하반기", "상반기"), false);
  assert.equal(isTemplatePeriodApplicable("annual", "상반기(수시)"), false);
});

test("관리자·API·DB가 annual을 지원하고 잘못된 값은 거부한다", () => {
  const component = readFileSync("components/features/DocumentTemplateManagement.tsx", "utf8");
  const api = readFileSync("app/api/document-templates/route.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260724_add_annual_document_template_period.sql",
    "utf8"
  );

  assert.match(component, /value: ANNUAL_TEMPLATE_PERIOD, label: "연간 공통"/);
  assert.match(component, /이 연도·주기의 기본 양식으로 지정/);
  assert.match(api, /parseTemplateMeasurementPeriod/);
  assert.match(api, /지원하지 않는 적용 주기입니다/);
  assert.match(migration, /'상반기', '하반기', 'annual'/);
  assert.match(migration, /uq_document_templates_one_active/);
});

test("생성 API는 같은 연도의 정확 주기와 annual 후보만 조회한다", () => {
  const route = readFileSync("app/api/document-generation/route.ts", "utf8");
  assert.match(route, /\.eq\("measurement_year", target\.year\)/);
  assert.match(route, /\.in\("measurement_period", \[period, ANNUAL_TEMPLATE_PERIOD\]\)/);
  assert.match(route, /selectApplicableDocumentTemplates/);
  assert.match(route, /적용 가능한 활성 양식이 없는 항목/);
});
