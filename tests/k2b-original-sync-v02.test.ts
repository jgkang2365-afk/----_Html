import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildK2BSyncRange, buildK2BSourceKey, inclusiveK2BDates, parseK2BSubmissionGrid } from "../lib/automation/k2b-original-sync";

const requiredHeaders = ["청구 파일명", "사업장명", "처리상태", "접수일", "사업년도", "반기", "지원구분", "접수번호", "관리번호", "개시번호", "순번"];
const completeRow = ["alpha.xml", "알파", "정상처리", "2026-09-04", "2026", "하반기", "국고", "R-1", "M-1", "C-1", "1"];

test("scheduled range는 cursor 신규구간과 D-3 overlap의 합집합을 포함한다", () => {
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-07", lastSuccessfulThroughDate: "2026-09-04" }), { fromDate: "2026-09-04", toDate: "2026-09-06" });
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-07", lastSuccessfulThroughDate: "2026-09-01" }), { fromDate: "2026-09-02", toDate: "2026-09-06" });
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-07", lastSuccessfulThroughDate: "2026-09-06" }), { fromDate: "2026-09-04", toDate: "2026-09-06" });
  assert.deepEqual(inclusiveK2BDates({ fromDate: "2026-09-03", toDate: "2026-09-04" }), ["2026-09-03", "2026-09-04"]);
});

test("manual은 명시 range만 받고 unknown trigger 추론을 금지한다", () => {
  assert.deepEqual(buildK2BSyncRange({ trigger: "manual", today: "2026-09-07", fromDate: "2026-09-02", toDate: "2026-09-03" }), { fromDate: "2026-09-02", toDate: "2026-09-03" });
  assert.throws(() => buildK2BSyncRange({ trigger: "unknown", today: "2026-09-07" }), /K2B_SYNC_UNKNOWN_TRIGGER/);
  assert.throws(() => buildK2BSyncRange({ trigger: "manual", today: "2026-09-07" }), /K2B_SYNC_MANUAL_RANGE_REQUIRED/);
});

test("K2B header mapping은 실제 필수 header와 submission number를 보존한다", () => {
  const parsed = parseK2BSubmissionGrid(requiredHeaders, [completeRow]);
  assert.equal(parsed.outcome, "SUCCESS");
  assert.equal(parsed.rows[0].actualSubmissionDate, "2026-09-04");
  assert.equal(parsed.rows[0].submissionNumber, "R-1");
  assert.equal(parsed.rows[0].fileName, "alpha.xml");
  assert.equal(parsed.rows[0].identityFallback, false);
});

test("missing/duplicate header는 K2B_GRID_SCHEMA_MISMATCH로 fail-safe 처리한다", () => {
  assert.throws(() => parseK2BSubmissionGrid(requiredHeaders.filter(value => value !== "관리번호"), [completeRow]), /K2B_GRID_SCHEMA_MISMATCH:missing_managementNumber/);
  assert.throws(() => parseK2BSubmissionGrid([...requiredHeaders, "청구 파일명"], [[...completeRow, "copy.xml"]]), /K2B_GRID_SCHEMA_MISMATCH:ambiguous_fileName/);
});

test("동일 physical header를 가리키는 정규화 별칭은 한 번만 세고, 실제 중복 header는 차단한다", () => {
  const parsed = parseK2BSubmissionGrid(requiredHeaders, [completeRow]);
  assert.equal(parsed.outcome, "SUCCESS");
  assert.throws(
    () => parseK2BSubmissionGrid([...requiredHeaders, "사업장 명"], [[...completeRow, "알파 복제"]]),
    /K2B_GRID_SCHEMA_MISMATCH:ambiguous_companyName/,
  );
});

test("0 row는 성공 빈 결과이며 접수번호 없는 문서화된 fallback은 파일명·접수일·관리번호만 사용한다", () => {
  assert.equal(parseK2BSubmissionGrid(requiredHeaders, []).outcome, "SUCCESS_EMPTY");
  const parsed = parseK2BSubmissionGrid(requiredHeaders, [[...completeRow.slice(0, 7), "", ...completeRow.slice(8)]]);
  assert.equal(parsed.rows[0].identityFallback, true);
  assert.match(parsed.rows[0].sourceKey, /^k2b:fallback:/);
  assert.deepEqual(buildK2BSourceKey({ submissionNumber: "", fileName: "alpha.xml", actualSubmissionDate: "2026-09-04", managementNumber: "M-1" }), buildK2BSourceKey({ submissionNumber: "", fileName: "alpha.xml", actualSubmissionDate: "2026-09-04", managementNumber: "M-1" }));
});

test("worker/migration은 날짜별 결과, cursor guard, idempotency disposition과 legacy 계약을 함께 보존한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260907110000_add_k2b_original_sync_v02.sql", "utf8");
  const legacyRoute = readFileSync("app/api/report-processing/verify-k2b/route.ts", "utf8");
  assert.match(worker, /dateResults/); assert.match(worker, /SUCCESS_EMPTY/); assert.match(worker, /QUERY_FAILED/); assert.match(worker, /cursorEligible/); assert.match(worker, /fallbackKeyCount/);
  assert.match(migration, /submission_number TEXT,/); assert.match(migration, /last_successful_sync_at/); assert.match(migration, /created_at TIMESTAMPTZ/); assert.match(migration, /updated_at TIMESTAMPTZ/); assert.match(migration, /'unchanged'/);
  assert.match(legacyRoute, /enqueue_k2b_verify_job/);
});

test("forward migration의 legacy claim은 active original sync도 upload/verify와 동일하게 직렬화한다", () => {
  const migration = readFileSync("supabase/migrations/20260907110000_add_k2b_original_sync_v02.sql", "utf8");
  const claim = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_k2b_legacy_direct_job"));
  assert.match(claim, /job_type IN \('k2b', 'k2b_verify', 'k2b_original_sync', 'k2b_legacy_direct'\)/);
  assert.match(claim, /VALUES \('k2b_legacy_direct', 'processing', p_payload/);
  assert.match(claim, /REVOKE ALL ON FUNCTION public\.claim_k2b_legacy_direct_job\(JSONB\) FROM PUBLIC, anon, authenticated/);
  assert.match(claim, /GRANT EXECUTE ON FUNCTION public\.claim_k2b_legacy_direct_job\(JSONB\) TO service_role/);
});

test("원본 동기화 worker는 remote read 시도·실행 여부를 execution_result에 별도로 기록한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const originalSync = worker.slice(worker.indexOf("private async processK2BOriginalSyncJob"), worker.indexOf("private async processK2BJob"));
  assert.match(originalSync, /remoteK2BReadAttempted: false, remoteK2BReadExecuted: false/);
  assert.match(originalSync, /executionResult\.remoteK2BReadAttempted = true/);
  assert.match(originalSync, /executionResult\.remoteK2BReadExecuted = true/);
});
