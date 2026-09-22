import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildK2BSyncRange, buildK2BSourceKey, filterK2BObservedJournalCandidates, inclusiveK2BDates, parseK2BSubmissionGrid, resolveK2BJournalScope } from "../lib/automation/k2b-original-sync";

const requiredHeaders = ["청구 파일명", "사업장명", "처리상태", "접수일", "사업년도", "반기", "지원구분", "접수번호", "관리번호", "개시번호", "순번"];
const completeRow = ["alpha.xml", "알파", "정상처리", "2026-09-04", "2026", "하반기", "국고", "R-1", "M-1", "C-1", "1"];

test("scheduled range는 cursor 신규구간과 완료된 최근 7일 재확인의 합집합을 포함한다", () => {
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-07", lastSuccessfulThroughDate: "2026-09-04" }), { fromDate: "2026-08-31", toDate: "2026-09-06" });
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-07", lastSuccessfulThroughDate: "2026-09-01" }), { fromDate: "2026-08-31", toDate: "2026-09-06" });
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-07", lastSuccessfulThroughDate: "2026-09-06" }), { fromDate: "2026-08-31", toDate: "2026-09-06" });
  assert.deepEqual(inclusiveK2BDates({ fromDate: "2026-09-03", toDate: "2026-09-04" }), ["2026-09-03", "2026-09-04"]);
});

test("manual은 명시 range만 받고 unknown trigger 추론을 금지한다", () => {
  assert.deepEqual(buildK2BSyncRange({ trigger: "manual", today: "2026-09-07", fromDate: "2026-09-02", toDate: "2026-09-03" }), { fromDate: "2026-09-02", toDate: "2026-09-03" });
  assert.throws(() => buildK2BSyncRange({ trigger: "unknown", today: "2026-09-07" }), /K2B_SYNC_UNKNOWN_TRIGGER/);
  assert.throws(() => buildK2BSyncRange({ trigger: "manual", today: "2026-09-07" }), /K2B_SYNC_MANUAL_RANGE_REQUIRED/);
});

test("K2B receipt business year and half scope는 canonical matching에 사용된다", () => {
  assert.deepEqual(resolveK2BJournalScope({ businessYear: "2026", half: "하반기" }), { measurementYear: 2026, measurementPeriod: "하반기" });
  assert.deepEqual(resolveK2BJournalScope({ businessYear: "2026년", half: "상 반기" }), { measurementYear: 2026, measurementPeriod: "상반기" });
  assert.throws(() => resolveK2BJournalScope({ businessYear: "26", half: "하반기" }), /invalid_business_scope/);
  assert.throws(() => resolveK2BJournalScope({ businessYear: "2026", half: "3분기" }), /invalid_business_scope/);
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const originalSync = worker.slice(worker.indexOf("private async processK2BOriginalSyncJob"), worker.indexOf("private async processK2BJob"));
  assert.match(originalSync, /measurementYear: journal\.measurement_year, measurementPeriod: journal\.measurement_period/);
  assert.match(originalSync, /businessYear: receipt\.businessYear, half: receipt\.half/);
  assert.match(originalSync, /reconcileK2BSubmissionResults/);
});

test("scheduled 원본 동기화는 이번 receipt canonical 4-key에 없는 journal을 reconciliation 후보에서 제외한다", () => {
  const receipts = [{
    managementNumber: "123-45", commencementNumber: "00001", businessYear: "2026", half: "하반기",
  }];
  const journals = [
    { id: 1, industrialAccidentNumber: "12345", commencementNumber: "00001", measurementYear: 2026, measurementPeriod: "하반기" },
    { id: 2, industrialAccidentNumber: "12345", commencementNumber: "00001", measurementYear: 2026, measurementPeriod: "상반기" },
    { id: 3, industrialAccidentNumber: "99999", commencementNumber: "00001", measurementYear: 2026, measurementPeriod: "하반기" },
  ];
  assert.deepEqual(filterK2BObservedJournalCandidates(journals, receipts).map(row => row.id), [1]);
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const originalSync = worker.slice(worker.indexOf("private async processK2BOriginalSyncJob"), worker.indexOf("private async processK2BJob"));
  assert.match(originalSync, /const observedJournals = filterK2BObservedJournalCandidates/);
  assert.match(originalSync, /reconcileK2BSubmissionResults\(observedJournals\.map/);
  assert.match(originalSync, /selectK2BStaleUpdates\(staleCandidates \|\| \[\]\)/);
  assert.doesNotMatch(originalSync, /observedJournalIds\.has\(candidate\.id\)/);
});

test("K2B header mapping은 실제 필수 header와 submission number를 보존한다", () => {
  const parsed = parseK2BSubmissionGrid(requiredHeaders, [completeRow]);
  assert.equal(parsed.outcome, "SUCCESS");
  assert.equal(parsed.rows[0].actualSubmissionDate, "2026-09-04");
  assert.equal(parsed.rows[0].submissionNumber, "R-1");
  assert.equal(parsed.rows[0].fileName, "alpha.xml");
  assert.equal(parsed.rows[0].identityFallback, false);
  const industrialHeader = parseK2BSubmissionGrid(requiredHeaders.map((header) => header === "관리번호" ? "산재관리번호" : header), [completeRow]);
  assert.equal(industrialHeader.rows[0].managementNumber, "M-1");
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

test("grid reader fallback identity matches persisted receipt identity and isolates unmatchable file-error rows", () => {
  const reader = readFileSync("lib/automation/k2b-grid-reader.ts", "utf8");
  const start = reader.indexOf("const identityReader = headers =>");
  const end = reader.indexOf("const errorValue = value =>", start);
  const identity = reader.slice(start, end);
  assert.match(identity, /const submissionDate = fieldIndex/);
  assert.match(identity, /const status = fieldIndex/);
  assert.match(identity, /if \(!managementValue\) return JSON\.stringify\(\['unmatchable'/);
  assert.match(identity, /return JSON\.stringify\(\['fallback', fileValue, dateValue, managementValue\]\)/);
  assert.doesNotMatch(identity, /const sequence = fieldIndex/);
  assert.doesNotMatch(identity, /const commencement = fieldIndex/);
});

test("business-identity-free K2B file-error row is preserved as unmatchable without poisoning a COMPLETE grid", () => {
  const orphan = ["bad.xml", "", "\uD30C\uC77C\uC624\uB958", "2026-08-20", "", "", "", "", "", "", ""];
  const parsed = parseK2BSubmissionGrid(requiredHeaders, [orphan], {
    expectedRowCount: 1, collectedUniqueRowCount: 1, readMethod: "nexacro_dataset", completeness: "COMPLETE",
  });
  assert.equal(parsed.outcome, "SUCCESS");
  assert.equal(parsed.completeness, "COMPLETE");
  assert.equal(parsed.rows[0].unmatchableError, true);
  assert.equal(parsed.rows[0].managementNumber, "");
  assert.match(parsed.rows[0].sourceKey, /^k2b:unmatchable:/);
  const malformed = ["bad.xml", "partial company", "\uD30C\uC77C\uC624\uB958", "2026-08-20", "2026", "\uD558\uBC18\uAE30", "x", "", "", "", ""];
  assert.throws(() => parseK2BSubmissionGrid(requiredHeaders, [malformed]), /K2B_GRID_SCHEMA_MISMATCH:invalid_required_row_0/);
});

test("worker/migration은 날짜별 결과, cursor guard, idempotency disposition과 legacy 계약을 함께 보존한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260907110000_add_k2b_original_sync_v02.sql", "utf8");
  const legacyRoute = readFileSync("app/api/report-processing/verify-k2b/route.ts", "utf8");
  // 0-row 결과를 포함한 parser outcome을 worker가 그대로 execution result에 보존한다.
  // 특정 outcome 문자열을 중복 하드코딩하지 않아도 SUCCESS_EMPTY를 loss 없이 전달한다.
  assert.match(worker, /dateResults/); assert.match(worker, /outcome: grid\.outcome/); assert.match(worker, /QUERY_FAILED/); assert.match(worker, /cursorEligible/); assert.match(worker, /fallbackKeyCount/);
  assert.match(worker, /K2B_UNMATCHABLE_REMOTE_ROWS/); assert.match(worker, /unmatchableRemoteRowCount/);
  assert.match(migration, /submission_number TEXT,/); assert.match(migration, /last_successful_sync_at/); assert.match(migration, /created_at TIMESTAMPTZ/); assert.match(migration, /updated_at TIMESTAMPTZ/); assert.match(migration, /'unchanged'/);
  assert.match(legacyRoute, /enqueue_k2b_automation_job/);
  assert.match(legacyRoute, /calendarSyncApiUrl/);
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
