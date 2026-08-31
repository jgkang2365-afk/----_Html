import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildPreliminarySurveyDisplayModel,
  formatMeasurementPublicSampleAssignee,
  formatPreliminarySurveyorWithPublicSampleCode,
  orderSurveyParticipantsForDisplay,
} from "../lib/preliminary-survey-v2/display-model";

test("V2 표시 모델은 legacy보다 우선하고 인쇄 괄호에는 코드만 쓴다", () => {
  const model = buildPreliminarySurveyDisplayModel({
    v2: {
      preliminarySurveyDate: "2026-07-24",
      preliminarySurveyors: "이태환, 강종구",
      measurementPublicSampleAssignee: "강종구",
      publicSampleCode: "C",
    },
    measurementParticipants: "강종구",
    reportWriter: "강종구",
    legacy: {
      preliminarySurveyors: "다른 사람",
      measurementPublicSampleAssignee: "다른 사람",
      publicSampleCode: "A",
    },
  });
  assert.equal(model.source, "v2");
  assert.equal(model.measurementPublicSampleAssignee, "강종구");
  assert.equal(formatMeasurementPublicSampleAssignee(model), "강종구(C)");
  assert.equal(formatPreliminarySurveyorWithPublicSampleCode(model), "이태환, 강종구 (C)");
  assert.doesNotMatch(formatPreliminarySurveyorWithPublicSampleCode(model), /강종구\(C\)/);
});

test("저장된 V2 plan의 누락값은 legacy fallback으로 가리지 않는다", () => {
  const model = buildPreliminarySurveyDisplayModel({
    v2: {},
    legacy: {
      preliminarySurveyors: "legacy 조사자",
      measurementPublicSampleAssignee: "legacy 공시료",
      publicSampleCode: "A",
    },
  });

  assert.equal(model.source, "v2");
  assert.equal(model.preliminarySurveyors, "-");
  assert.equal(model.measurementPublicSampleAssignee, "-");
});

test("복수 예비조사자는 경력자 먼저 표시하되 responsible ID를 바꾸지 않는다", () => {
  const responsible = { id: 2, name: "강종구", experienced: false };
  const reviewer = { id: 15, name: "이태환", experienced: true };
  const ordered = orderSurveyParticipantsForDisplay([responsible, reviewer]);
  assert.deepEqual(ordered.map((user) => user.name), ["이태환", "강종구"]);
  assert.equal(responsible.id, 2);
});

test("요약 API와 수정 모달은 공통 V2 표시 모델을 사용한다", () => {
  const summary = readFileSync("app/api/summary/route.ts", "utf8");
  const modal = readFileSync("components/features/JournalEditForm.tsx", "utf8");
  const table = readFileSync("components/features/SummaryTable.tsx", "utf8");
  assert.match(summary, /buildPreliminarySurveyDisplayModel/);
  assert.match(summary, /measurementDayFormsFrom/);
  assert.match(summary, /measurementPublicSampleAssignee: survey\.measurer/);
  assert.match(modal, /preliminaryDisplay/);
  assert.match(modal, /\["예비조사일"/);
  assert.match(modal, /"측정자\(공시료\)"/);
  assert.match(table, /PreliminarySummaryFields/);
  assert.match(table, /formatPreliminarySurveyorWithPublicSampleCode/);
  assert.match(table, /formatMeasurementPublicSampleAssignee/);
  assert.match(table, /md:grid-cols-4/);
  assert.match(table, /md:grid-cols-3/);
  assert.doesNotMatch(table, /hidden grid-cols-1 md:grid-cols-3 print:grid-cols-3/);
  const previousData = readFileSync("app/api/journal/previous-data/route.ts", "utf8");
  assert.match(previousData, /legacyDisplaySource = surveys\.find/);
  assert.doesNotMatch(previousData, /legacyDisplaySource = surveys\[0\]/);
});
