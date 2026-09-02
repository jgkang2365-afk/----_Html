
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const summaryUi = fs.readFileSync("components/features/SummaryTable.tsx", "utf8");
const summaryApi = fs.readFileSync("app/api/summary/route.ts", "utf8");
const journalForm = fs.readFileSync("components/features/JournalEditForm.tsx", "utf8");
const previousDataApi = fs.readFileSync("app/api/journal/previous-data/route.ts", "utf8");

test("summary uses separate current Canonical role cells", () => {
  assert.match(summaryUi, /cell\("예비조사일"/);
  assert.match(summaryUi, /cell\("예비조사자", display\.preliminarySurveyors\)/);
  assert.match(summaryUi, /cell\("측정자\(공시료\)", formatMeasurementPublicSampleAssignee\(display\)\)/);
  assert.match(summaryUi, /cell\("측정 참여자", display\.measurementParticipants\)/);
  assert.doesNotMatch(summaryUi, /예비조사자명\(공시료 코드\)/);
});

test("summary role projection never uses a loose cross-period target", () => {
  assert.match(summaryApi, /const displayTarget = exactTarget;/);
  assert.match(summaryApi, /public_sample_code/);
  assert.match(summaryApi, /measurementPublicSampleAssignments/);
  assert.match(summaryApi, /measurementRolesForDisplay/);
});

test("journal measurement participant is read-only current-period Canonical data", () => {
  assert.match(journalForm, /label="측정 참여자"/);
  assert.match(journalForm, /measurer: ""/);
  assert.match(journalForm, /data\.currentMeasurementParticipants/);
  assert.doesNotMatch(journalForm, /updated\.measurer = updated\.measurer \|\| data\.previousData\.measurer/);
  assert.doesNotMatch(journalForm, /const allMeasurers = new Set<string>/);
});

test("previous-data Canonical projection is exact code year period", () => {
  assert.match(previousDataApi, /\.eq\("code", trimmedCode\)/);
  assert.match(previousDataApi, /\.eq\("year", measurementYear\)/);
  assert.match(previousDataApi, /\.eq\("period", period\)/);
  assert.match(previousDataApi, /preliminaryDisplay/);
});


test("multi-day current measurement participants are collected from the exact target only", () => {
  const dayForm = fs.readFileSync("lib/business/measurement-day-form.ts", "utf8");
  assert.match(dayForm, /export function collectMeasurementParticipantNames/);
  assert.match(dayForm, /measurementDayFormsFrom\(source\)\.flatMap/);
  assert.match(summaryApi, /const displayTarget = exactTarget;/);
  assert.match(summaryApi, /currentMeasurementParticipants/);
});

test("journal keeps previous comparison values but never injects previous measurer into the current role", () => {
  assert.match(journalForm, /setPreviousContactInfo/);
  assert.match(journalForm, /setPreviousMeasurementFee/);
  assert.match(journalForm, /currentMeasurementParticipants/);
  assert.match(journalForm, /currentRoleLoadSequence/);
  assert.doesNotMatch(journalForm, /measurer: entry\.measurer \|\| ""/);
  assert.doesNotMatch(journalForm, /updated\.measurer = updated\.measurer \|\| data\.previousData\.measurer/);
});

test("historical reference fetch cannot overwrite the current role display", () => {
  assert.doesNotMatch(journalForm, /setPreliminaryDisplay\(data\.preliminaryDisplay \|\| null\)/);
  assert.match(journalForm, /const currentPreliminaryDisplay = data\.preliminaryDisplay \|\| null/);
  assert.match(journalForm, /requestSequence !== currentRoleLoadSequence\.current/);
});

test("read-only current participant values are not written back by edit modals", () => {
  assert.match(journalForm, /if \(entry\.id\) delete submitData\.measurer/);
  assert.match(summaryUi, /delete saveData\.measurer/);
});

test("previous-data exposes current exact-period participants separately from history", () => {
  assert.match(previousDataApi, /currentMeasurementParticipants/);
  assert.match(previousDataApi, /collectMeasurementParticipantNames/);
  assert.match(previousDataApi, /previousData/);
});
