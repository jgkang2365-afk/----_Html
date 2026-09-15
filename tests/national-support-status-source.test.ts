import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("수동 placeholder와 실제 확정 결과의 status_source 경계가 migration에 명시된다", () => {
  const migration = read("supabase/migrations/20260915090000_add_national_support_representative.sql");
  const terminal = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_national_support_automation_job"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.sync_manual_national_support_application"),
  );
  const manual = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.sync_manual_national_support_application"));

  assert.match(migration, /ADD COLUMN IF NOT EXISTS status_source text NULL/);
  assert.match(migration, /status_source IN \('manual_internal', 'confirmed_result'\)/);
  assert.match(terminal, /'confirmed_result'/);
  assert.match(terminal, /status_source=EXCLUDED\.status_source/);
  assert.match(manual, /'manual_internal'/);
  assert.match(manual, /WHERE public\.national_support_application\.status_source IS DISTINCT FROM 'confirmed_result'/);
  assert.match(manual, /application_status IS NULL[\s\S]*result IS NULL/);
});

test("apply shortcut은 confirmed 결과 또는 legacy 실제 결과 증거에만 허용한다", () => {
  const route = read("app/api/businesses/national-support/apply/route.ts");
  assert.match(route, /national_support_status, status_source, application_status, result/);
  assert.match(route, /existingApp\.status_source === "confirmed_result"/);
  assert.match(route, /hasManualInternalPlaceholder/);
  assert.match(route, /currentPlan\.national_support_status === "비대상" && !hasManualInternalPlaceholder/);
  assert.match(route, /existingApp\.status_source == null && Boolean\(existingApp\.result \|\| existingApp\.application_status\)/);
  assert.match(route, /hasConfirmedExistingResult/);
});

test("업로드와 명시적 결과 등록/수정은 실제 확정 원천으로 저장한다", () => {
  for (const relativePath of [
    "app/api/businesses/national-support/upload/route.ts",
    "app/api/businesses/national-support/route.ts",
    "app/api/businesses/national-support/[id]/route.ts",
  ]) {
    assert.match(read(relativePath), /status_source: "confirmed_result"/);
  }
});
