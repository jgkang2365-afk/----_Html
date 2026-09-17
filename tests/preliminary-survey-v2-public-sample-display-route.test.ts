import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workbenchRoute = readFileSync(
  resolve(process.cwd(), "app/api/preliminary-survey-v2/workbench/route.ts"),
  "utf8",
);

test("workbench V2 표시 조회는 public_sample_code를 resolver에 전달한다", () => {
  assert.match(
    workbenchRoute,
    /id, plan_id, measurement_date, assignee_user_id, public_sample_code, approval_required/,
  );
  assert.match(workbenchRoute, /publicSampleCode: persistedAssignment\.public_sample_code/);
  assert.match(workbenchRoute, /publicSampleCode: dayAssignment\.public_sample_code/);
  assert.doesNotMatch(workbenchRoute, /surveyCode: persistedAssignment\.survey_code/);
  assert.doesNotMatch(workbenchRoute, /surveyCode: dayAssignment\.survey_code/);
});
