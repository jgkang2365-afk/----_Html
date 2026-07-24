import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("운영 스키마용 큐 함수는 없는 journal_id 대신 정확한 code year period를 사용한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260724_fix_document_generation_journal_lookup.sql",
    "utf8"
  );

  assert.doesNotMatch(migration, /target_row\.journal_id/);
  assert.match(migration, /journal\.code = target_row\.code/);
  assert.match(migration, /journal\.measurement_year = target_row\.year/);
  assert.match(migration, /journal\.measurement_period = target_row\.period/);
});
