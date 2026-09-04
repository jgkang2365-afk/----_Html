import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("고정 측정자는 자동으로 되돌릴 수 있고 해당 날짜 release RPC를 사용한다", () => {
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.match(ui, /<option value="">자동<\/option>/);
  assert.doesNotMatch(ui, /<option value="" disabled=\{Boolean\(fixed\)\}>자동<\/option>/);
  assert.match(ui, /action: "release_fixed"/);
  assert.match(ui, /고정 측정자 지정을 해제하고 자동배정으로 전환하시겠습니까/);
  assert.match(route, /body\.action === "release_fixed"/);
  assert.match(route, /release_preliminary_survey_v2_fixed_assignment/);
  assert.match(route, /p_expected_assignee_user_id: fixed\.assigneeUserId/);
  assert.match(route, /p_expected_updated_at: fixed\.updatedAt/);
});

test("release migration은 단일 target/date만 지우고 stale·8월 경계를 보호한다", () => {
  const sql = readFileSync("supabase/migrations/20260904103000_add_fixed_assignee_release.sql", "utf8");
  assert.match(sql, /measurement_target_business_id = p_target_id/);
  assert.match(sql, /measurement_date = p_measurement_date/);
  assert.match(sql, /fixed_row\.updated_at IS DISTINCT FROM p_expected_updated_at/);
  assert.match(sql, /MESSAGE = 'SOURCE_CHANGED'/);
  assert.match(sql, /MESSAGE = 'TRANSITION_BOUNDARY_REVIEW_REQUIRED'/);
  assert.match(sql, /DELETE FROM public\.preliminary_survey_v2_fixed_assignments/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/);
});

test("canonical은 고정 측정자 자동 복귀와 관리자 지정 재검토를 명시한다", () => {
  const doc = readFileSync("docs/business-rules/preliminary-survey.md", "utf8");
  assert.match(doc, /고정 측정자를 해당 실제 측정일에 한해 `자동`으로 되돌릴 수 있다/);
  assert.match(doc, /관리자 지정 재검토 필요/);
});
