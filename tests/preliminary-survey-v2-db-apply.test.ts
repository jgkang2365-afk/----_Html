import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("schema migration은 nullable/no-default 분류 컬럼과 OFF 정책을 추가한다", () => {
  const sql = read("supabase/migrations/20260814090000_add_preliminary_survey_classification_schema.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS business_type text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS process_changed boolean/);
  assert.doesNotMatch(sql, /business_type text[^,;\n]*DEFAULT/i);
  assert.doesNotMatch(sql, /process_changed boolean[^,;\n]*DEFAULT/i);
  assert.match(sql, /preliminary_survey_policy_settings/);
  assert.match(sql, /VALUES \('process_changed_preliminary_survey', false, NULL, NULL, NULL\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
});

test("business_type backfill은 330건과 302\/21\/7을 transaction 안에서 검증한다", () => {
  const sql = read("supabase/migrations/20260814090100_backfill_2026_h2_business_type.sql");
  const rows = [...sql.matchAll(/^\s*\('H\d+', 2026, '하반기', '(existing|first_measurement|external_new)'\)[,;]?$/gm)];
  assert.equal(rows.length, 330);
  assert.equal(rows.filter((row) => row[1] === "existing").length, 302);
  assert.equal(rows.filter((row) => row[1] === "first_measurement").length, 21);
  assert.equal(rows.filter((row) => row[1] === "external_new").length, 7);
  assert.match(sql, /GET DIAGNOSTICS v_affected = ROW_COUNT/);
  assert.match(sql, /IF v_affected <> 330/);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
});

test("process_changed 초기화는 target exact 업종과 명시 journal token만 사용한다", () => {
  const sql = read("supabase/migrations/20260814090200_initialize_2026_h2_process_changed.sql");
  assert.match(sql, /btrim\(business_category\) IN \('공업사', '건설'\)/);
  assert.match(sql, /'공정 변경' = ANY/);
  assert.doesNotMatch(sql, /business_info|main_product|business_name\s+(?:LIKE|ILIKE)/i);
  assert.doesNotMatch(sql, /SET process_changed = false/i);
  assert.match(sql, /v_false_outside_exact <> 0/);
});

test("정책 API는 실제 관리자 permission을 강제한다", () => {
  const source = read("app/api/admin/preliminary-survey-policy/route.ts");
  assert.equal((source.match(/checkPermission\("system:settings"\)/g) || []).length, 2);
});

test("journal 저장은 target 업종을 우선하고 journal에서 target 업종을 역동기화하지 않는다", () => {
  const createSource = read("app/api/journal/route.ts");
  const updateSource = read("app/api/journal/[id]/route.ts");
  assert.match(createSource, /resolveTargetBusinessCategory\(\s*targetStateBeforeSave\?\.business_category/);
  assert.match(updateSource, /resolveTargetBusinessCategory\(\s*targetState\?\.business_category/);
  assert.doesNotMatch(createSource, /manager_phone: journalData\.phone,\s*business_category:/);
  assert.doesNotMatch(updateSource, /manager_phone: updatedJournal\.phone,\s*business_category:/);
});
