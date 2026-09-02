
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
  assert.match(journalForm, /data\.preliminaryDisplay\.measurementParticipants/);
  assert.doesNotMatch(journalForm, /updated\.measurer = updated\.measurer \|\| data\.previousData\.measurer/);
  assert.doesNotMatch(journalForm, /const allMeasurers = new Set<string>/);
});

test("previous-data Canonical projection is exact code year period", () => {
  assert.match(previousDataApi, /\.eq\("code", trimmedCode\)/);
  assert.match(previousDataApi, /\.eq\("year", measurementYear\)/);
  assert.match(previousDataApi, /\.eq\("period", period\)/);
  assert.match(previousDataApi, /preliminaryDisplay/);
});
