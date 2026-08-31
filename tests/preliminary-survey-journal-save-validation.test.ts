import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateJournalSavePreliminarySurveySource } from "../lib/preliminary-survey-v2/journal-save-validation";

const target = {
  measurement_date: "2026-08-27",
  measurement_end_date: "2026-08-27",
  daily_staff: [{ date: "2026-08-27", staff: [{ id: 13, name: "이주형" }] }],
  measurer_id: 13,
  collaborators: "이주형",
};

test("측정일지 저장 직전 V2 원천/공시료 일정만 target과 재검증한다", () => {
  assert.equal(validateJournalSavePreliminarySurveySource({
    target, body: { measurement_start_date: "2026-08-27" },
    plans: [{ id: "p1", source_measurement_date: "2026-08-27" }],
    assignments: [{ plan_id: "p1", measurement_date: "2026-08-27" }],
  }), null);
  assert.equal(validateJournalSavePreliminarySurveySource({
    target, body: { measurement_start_date: "2026-08-26" }, plans: [], assignments: [],
  })?.code, "JOURNAL_TARGET_SCHEDULE_MISMATCH");
  assert.equal(validateJournalSavePreliminarySurveySource({
    target, body: {}, plans: [{ id: "p1", source_measurement_date: "2026-08-26" }], assignments: [],
  })?.code, "PRELIMINARY_SURVEY_STALE");
  assert.equal(validateJournalSavePreliminarySurveySource({
    target, body: {}, plans: [{ id: "p1", source_measurement_date: "2026-08-27" }],
    assignments: [{ plan_id: "p1", measurement_date: "2026-08-26" }],
  })?.code, "PRELIMINARY_SURVEY_STALE");
  // V2가 없는 legacy-only 행은 source gate가 아닌 기존 journal 저장 흐름을 따른다.
  assert.equal(validateJournalSavePreliminarySurveySource({ target, body: {}, plans: [], assignments: [] }), null);
});

test("journal route는 V2 gate를 번호 부여보다 앞에 두고 target 날짜를 저장 원천으로 쓴다", () => {
  const route = readFileSync("app/api/journal/route.ts", "utf8");
  assert.ok(route.indexOf("const preliminarySurveyGate = validateJournalSavePreliminarySurveySource") < route.indexOf("const assignedNumbers = await assignAllNumbers"));
  assert.match(route, /measurement_start_date: targetJournalSchedule\?\.start \|\| measurement_start_date/);
  assert.match(route, /measurement_end_date: targetJournalSchedule\?\.end \|\| measurement_end_date/);
  assert.match(route, /code: preliminarySurveyGate\.code[\s\S]*status: 409/);
});

test("다일 일정은 daily_staff의 정렬된 첫·마지막 일자와 V2 assignment 전체를 정확히 맞춘다", () => {
  const multi = {
    ...target,
    measurement_date: "2026-08-27",
    measurement_end_date: "2026-08-29",
    daily_staff: [{ date: "2026-08-29" }, { date: "2026-08-27" }, { date: "2026-08-28" }],
  };
  assert.equal(validateJournalSavePreliminarySurveySource({
    target: multi,
    body: { measurement_start_date: "2026-08-27", measurement_end_date: "2026-08-29", daily_staff: multi.daily_staff },
    plans: [{ id: "p1", source_measurement_date: "2026-08-27" }],
    assignments: [
      { plan_id: "p1", measurement_date: "2026-08-27" },
      { plan_id: "p1", measurement_date: "2026-08-28" },
      { plan_id: "p1", measurement_date: "2026-08-29" },
    ],
  }), null);
  assert.equal(validateJournalSavePreliminarySurveySource({
    target: multi, body: { measurement_start_date: "2026-08-27", measurement_end_date: "2026-08-28" }, plans: [], assignments: [],
  })?.code, "JOURNAL_TARGET_SCHEDULE_MISMATCH");
  assert.equal(validateJournalSavePreliminarySurveySource({
    target: multi, body: {}, plans: [{ id: "p1", source_measurement_date: "2026-08-27" }],
    assignments: [{ plan_id: "p1", measurement_date: "2026-08-30" }],
  })?.code, "PRELIMINARY_SURVEY_STALE");
});
