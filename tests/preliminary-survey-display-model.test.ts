import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPreliminarySurveyDisplayModel,
  formatMeasurementPublicSampleAssignee,
  measurementRolesForDisplay,
} from "../lib/preliminary-survey-v2/display-model";

test("V2 plan이 있으면 5개 역할과 공시료 코드를 persisted V2/target 값으로 표시한다", () => {
  const model = buildPreliminarySurveyDisplayModel({
    v2: {
      preliminarySurveyDate: "2026-08-07",
      preliminarySurveyors: ["고유빈", "이주형"],
      preliminarySurveyorUsers: [
        { name: "고유빈", isExperienced: false },
        { name: "이주형", isExperienced: true },
      ],
      measurementPublicSampleAssignee: "고유빈",
      publicSampleCode: "F",
      measurementParticipants: ["고유빈"],
      reportWriter: "고유빈",
    },
    legacy: {
      preliminarySurveyDate: "legacy-date",
      preliminarySurveyors: "legacy-surveyor",
      measurementPublicSampleAssignee: "legacy-assignee",
      publicSampleCode: "Z",
      measurementParticipants: "legacy-participant",
      reportWriter: "legacy-writer",
    },
  });

  assert.deepEqual(model, {
    preliminarySurveyDate: "2026-08-07",
    preliminarySurveyors: "이주형, 고유빈",
    measurementPublicSampleAssignee: "고유빈",
    publicSampleCode: "F",
    measurementParticipants: "고유빈",
    reportWriter: "고유빈",
    source: "v2",
  });
  assert.equal(formatMeasurementPublicSampleAssignee(model), "고유빈(F)");
});

test("V2 plan이 없을 때만 legacy 표시값을 사용한다", () => {
  const model = buildPreliminarySurveyDisplayModel({
    legacy: {
      preliminarySurveyors: " 강종구, 이태환,강종구 ",
      preliminarySurveyorUsers: [
        { name: "강종구", isExperienced: false },
        { name: "이태환", isExperienced: true },
      ],
      measurementPublicSampleAssignee: "강종구",
      publicSampleCode: "C",
      measurementParticipants: "강종구",
      reportWriter: "이태환",
    },
  });

  assert.equal(model.source, "legacy");
  assert.equal(model.preliminarySurveyDate, null);
  assert.equal(model.preliminarySurveyors, "이태환, 강종구");
  assert.equal(formatMeasurementPublicSampleAssignee(model), "강종구(C)");
  assert.equal(model.measurementParticipants, "강종구");
  assert.equal(model.reportWriter, "이태환");
});

test("다일 공시료 담당자는 날짜별 public_sample_code를 모두 표시한다", () => {
  const model = buildPreliminarySurveyDisplayModel({
    v2: {
      preliminarySurveyDate: "2026-09-01",
      measurementPublicSampleAssignments: [
        { measurementDate: "2026-09-16", assignee: "고유빈", publicSampleCode: "F" },
        { measurementDate: "2026-09-14", assignee: "이태환", publicSampleCode: "A" },
        { measurementDate: "2026-09-15", assignee: "한기문", publicSampleCode: "B" },
      ],
    },
  });
  assert.equal(formatMeasurementPublicSampleAssignee(model), "09/14 이태환(A)\n09/15 한기문(B)\n09/16 고유빈(F)");
});

test("경력 정보가 일부만 확인되면 persisted 예비조사자 순서를 임의 변경하지 않는다", () => {
  const model = buildPreliminarySurveyDisplayModel({
    v2: {
      preliminarySurveyors: ["첫 번째", "두 번째"],
      preliminarySurveyorUsers: [{ name: "두 번째", isExperienced: true }],
    },
  });

  assert.equal(model.preliminarySurveyors, "첫 번째, 두 번째");
});

test("V2 plan의 일부 필드가 비어도 legacy 값으로 임의 보충하지 않는다", () => {
  const model = buildPreliminarySurveyDisplayModel({
    v2: {
      preliminarySurveyDate: "2026-08-07",
      preliminarySurveyors: [],
      measurementPublicSampleAssignee: null,
      publicSampleCode: "",
      measurementParticipants: [],
      reportWriter: null,
    },
    legacy: {
      preliminarySurveyors: "legacy-surveyor",
      measurementPublicSampleAssignee: "legacy-assignee",
      publicSampleCode: "Z",
      measurementParticipants: "legacy-participant",
      reportWriter: "legacy-writer",
    },
  });

  assert.deepEqual(model, {
    preliminarySurveyDate: "2026-08-07",
    preliminarySurveyors: "-",
    measurementPublicSampleAssignee: "-",
    publicSampleCode: "-",
    measurementParticipants: "-",
    reportWriter: "-",
    source: "v2",
  });
});

test("단일일 역할은 measurement_target_business 기본 참여자와 보고서 담당을 사용한다", () => {
  assert.deepEqual(measurementRolesForDisplay({
    measurementDate: "2026-09-01",
    collaborators: " 고유빈, 고유빈 ",
    measurerId: 16,
  }), {
    measurementParticipants: ["고유빈"],
    reportWriterUserId: 16,
  });
});

test("다일 역할은 해당 측정일 daily_staff 참여자와 보고서 담당만 사용한다", () => {
  assert.deepEqual(measurementRolesForDisplay({
    measurementDate: "2026-09-02",
    collaborators: "top-level-participant",
    measurerId: 99,
    dailyStaff: [
      { date: "2026-09-01", collaborators: ["첫날 참여자"], measurer_id: 10 },
      { date: "2026-09-02", collaborators: ["둘째날 참여자"], measurer_id: 20 },
    ],
  }), {
    measurementParticipants: ["둘째날 참여자"],
    reportWriterUserId: 20,
  });
});

test("previous-data API와 등록·수정 공통 폼은 V2 READ 표시 모델을 끝까지 연결한다", () => {
  const route = readFileSync("app/api/journal/previous-data/route.ts", "utf8");
  const form = readFileSync("components/features/JournalEditForm.tsx", "utf8");

  assert.match(route, /from\("preliminary_survey_v2_plans"\)/);
  assert.match(route, /from\("preliminary_survey_v2_measurement_assignments"\)/);
  assert.match(route, /participant_user_ids/);
  assert.match(route, /is_preliminary_survey_experienced/);
  assert.match(route, /\|\| hasPreliminaryDisplay/);
  assert.match(route, /preliminaryDisplay: hasPreliminaryDisplay \? preliminaryDisplay : null/g);
  assert.doesNotMatch(route, /from\("preliminary_survey_v2_(?:plans|measurement_assignments)"\)[\s\S]{0,120}\.(?:insert|update|upsert|delete)\(/);
  assert.doesNotMatch(route, /measurementParticipants[^\n]*\?\?[^\n]*legacy/);

  for (const label of ["예비조사일", "예비조사자", "측정자(공시료)", "측정 참여자", "보고서 담당"]) {
    assert.match(form, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.equal((form.match(/\{renderSurveyInfo\(\)\}/g) ?? []).length, 2);
});
