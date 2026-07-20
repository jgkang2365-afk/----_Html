import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const flowSource = readFileSync(
  path.join(root, "scratch", "national_support_flow_cli.py"),
  "utf8",
);
const workerSource = readFileSync(
  path.join(root, "lib", "automation", "national-support-worker.ts"),
  "utf8",
);
const targetManagementSource = readFileSync(
  path.join(root, "components", "features", "MeasurementTargetBusinessManagement.tsx"),
  "utf8",
);
const migrationSource = readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260718_limit_national_support_worker_concurrency.sql",
  ),
  "utf8",
);

test("업체 단위 통합 CLI는 WebDriver 하나를 조회와 신청에 재사용한다", () => {
  const executeFlow = flowSource.slice(flowSource.indexOf("def execute_flow("));
  assert.equal((executeFlow.match(/driver = create_driver\(\)/g) || []).length, 1);
  assert.match(executeFlow, /lookup_with_driver\(\s*driver,/);
  assert.match(executeFlow, /if lookup_result == "NO_RESULT":/);
  assert.match(executeFlow, /apply_with_driver\(\s*driver,/);
  assert.match(executeFlow, /finally:[\s\S]*driver\.quit\(\)/);
});

test("apply_if_missing만 통합 CLI를 사용하고 후속 조회는 조회 전용 CLI를 사용한다", () => {
  assert.match(workerSource, /"national_support_flow_cli\.py"/);
  assert.match(workerSource, /if \(mode === "apply_if_missing"\)[\s\S]*runIntegratedFlow\(payload\)/);
  assert.match(workerSource, /const lookupResult = resultCode\([\s\S]*await runCrawler\(payload\)/);
  assert.match(workerSource, /if \(mode === "final_lookup"\)/);
});

test("DB는 건강디딤돌 processing 작업을 한 건으로 제한한다", () => {
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_one_processing_national_support/,
  );
  assert.match(migrationSource, /job_type = 'national_support'/);
  assert.match(migrationSource, /status = 'processing'/);
});

test("측정대상 목록은 깡통컴의 국고 상태 변경을 계속 자동 반영한다", () => {
  assert.match(targetManagementSource, /cache: "no-store"/);
  assert.match(targetManagementSource, /"신청중", "조회중", "신청완료대기"/);
  assert.match(targetManagementSource, /hasPendingNationalSupport \? 3000 : 15000/);
  assert.match(targetManagementSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(targetManagementSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
});
