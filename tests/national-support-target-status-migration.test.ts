import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260915100000_harmonize_target_national_support_status.sql"),
  "utf8",
);

test("target 국고지원 상태 history 보정은 legacy 지원만 canonical 대상으로 정규화한다", () => {
  assert.match(migration, /national_support_status NOT IN \('지원', '대상', '비대상'\)/);
  assert.match(migration, /TARGET_NATIONAL_SUPPORT_STATUS_UNEXPECTED_VALUE/);
  assert.match(migration, /SET national_support_status = '대상'[\s\S]*WHERE national_support_status = '지원'/);
  assert.doesNotMatch(migration, /SET national_support_status = '지원'/);
});

test("target CHECK는 known legacy constraint만 canonical constraint로 교체한다", () => {
  assert.match(migration, /DROP CONSTRAINT measurement_target_business_national_support_status_check/);
  assert.match(migration, /TARGET_NATIONAL_SUPPORT_STATUS_CONSTRAINT_UNRECOGNIZED/);
  assert.match(migration, /national_support_status IS NULL[\s\S]*national_support_status IN \('대상', '비대상'\)/);
});

test("canonical constraint는 migration에서 no-op으로 종료한다", () => {
  assert.match(migration, /regexp_matches\(status_constraint_definition/);
  assert.match(migration, /status_constraint_values <@ ARRAY\['대상', '비대상'\]/);
  assert.match(migration, /RETURN;[\s\S]*-- Only the known historical target constraint/);
});

test("extra allowed status를 가진 constraint는 canonical no-op으로 오인하지 않는다", () => {
  assert.match(migration, /TARGET_NATIONAL_SUPPORT_STATUS_CONSTRAINT_UNRECOGNIZED/);
  assert.doesNotMatch(migration, /position\('''대상''' IN status_constraint_definition\)/);
});
