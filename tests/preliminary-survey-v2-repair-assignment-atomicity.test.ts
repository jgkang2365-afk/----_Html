import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260902120000_fix_repair_measurement_assignment_persistence.sql",
);

test("Repair persistence migration uses plan_id as the assignment relationship", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /JOIN public\.preliminary_survey_v2_plans existing_plan ON existing_plan\.id = assignment\.plan_id/);
  assert.doesNotMatch(sql, /measurement_assignments[^\n]*measurement_target_business_id/);
  assert.match(sql, /INSERT INTO public\.preliminary_survey_v2_measurement_assignments/);
});

test("Repair persistence is atomic through a wrapper that raises on missing or conflicting assignments", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /ALTER FUNCTION public\.repair_true_confirmed_preliminary_survey_v2_missing_info[\s\S]*RENAME TO/);
  assert.match(sql, /PERFORM public\.ensure_repair_measurement_assignments\(p_target_id, repaired\.id/);
  assert.match(sql, /REPAIR_MEASUREMENT_ASSIGNMENT_SOURCE_REQUIRED/);
  assert.match(sql, /REPAIR_MEASUREMENT_ASSIGNMENT_CONFLICT/);
  assert.match(sql, /filled_fields = CASE/);
});

test("Repair assignment persistence covers every multi-day daily_staff date", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /jsonb_array_elements\([\s\S]*target_row\.daily_staff/);
  assert.match(sql, /measurement_date := NULLIF\(measurement_day->>'date', ''\)::date/);
  assert.match(sql, /ON CONFLICT \(plan_id, measurement_date\) DO NOTHING/);
});

test("same-run automatic evidence is signed, forwarded to Repair Apply, and passed into the RPC", () => {
  const tokenCodec = fs.readFileSync(path.join(process.cwd(), "lib/preliminary-survey-v2/reverse-planner/preview-token-codec.ts"), "utf8");
  const reverseRoute = fs.readFileSync(path.join(process.cwd(), "app/api/preliminary-survey-v2/reverse-planner/route.ts"), "utf8");
  const repairRoute = fs.readFileSync(path.join(process.cwd(), "app/api/preliminary-survey-v2/confirmed-document-repair/route.ts"), "utf8");
  const ui = fs.readFileSync(path.join(process.cwd(), "components/features/FixedAssigneeReversePlanner.tsx"), "utf8");
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(tokenCodec, /effectiveMeasurementAssignments/);
  assert.match(reverseRoute, /effectiveMeasurementAssignments = output\.results\.flatMap/);
  assert.match(repairRoute, /verifyPreviewToken\(reversePreviewToken/);
  assert.match(ui, /reversePreviewToken: preview\.previewToken/);
  assert.match(migration, /COALESCE\(repair_item->'measurementAssignments'/);
});
