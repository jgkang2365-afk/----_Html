import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getIntegrityBusinessInfoAddress, hasIntegrityCoordinates, inspectMeasurementTargetIntegrity } from "../lib/measurement-target-integrity";
import { reconcileK2BSubmissionResults, verificationFailureState } from "../lib/k2b-verification";
import { getK2BVerifyUnresolvedSince, getPreviousKSTCalendarDate } from "../lib/scheduler/k2b-verification-policy";
import { enqueueSerializedK2BUpload } from "../lib/automation/k2b-job-queue";
import { requireK2BJournalPersistence } from "../lib/automation/k2b-upload-persistence";

const directory = { offices: [], aliases: [] };

test("측정대상 정합성 점검은 읽기 전용으로 결정적 불일치를 분류한다", () => {
  const issues = inspectMeasurementTargetIntegrity({
    targets: [{ code: "A", business_name: "알파", business_number: "111", address: "서울시 중구", year: 2026, period: "상반기", measurement_date: "2026-06-02", measurement_end_date: "2026-06-01", sync_status: "실패" }],
    businessInfos: [{ code: "A", business_name: "베타", business_number: "222", address1: "부산시", address2: "중구" }],
    journals: [{ code: "A", measurement_year: 2025, measurement_period: "하반기" }], laborOfficeDirectory: directory,
  });
  assert.deepEqual(issues.map((item) => item.type), ["사업장명 불일치", "사업자번호 불일치", "주소 불일치", "주소 대비 좌표 없음", "소재지지청 판정 불확실", "측정 시작/종료일 역전", "일지 코드/연도/주기 불일치", "동기화 조치 필요"]);
  assert.ok(issues.every((item) => item.status === "오류" || item.status === "확인필요"));
});

test("business_info의 실제 분리 주소와 좌표를 사용하고 null·undefined·비유한 좌표는 누락으로 본다", () => {
  assert.equal(getIntegrityBusinessInfoAddress({ code: "A", address1: "서울시 중구", address2: "세종대로 1" }), "서울시 중구 세종대로 1");
  assert.equal(hasIntegrityCoordinates({ code: "A", latitude: null, longitude: null }), false);
  assert.equal(hasIntegrityCoordinates({ code: "A", latitude: undefined, longitude: 127 }), false);
  assert.equal(hasIntegrityCoordinates({ code: "A", latitude: Number.NaN, longitude: 127 }), false);
  const issues = inspectMeasurementTargetIntegrity({
    targets: [{ code: "A", business_name: "알파", address: "서울시 중구 세종대로 1" }],
    businessInfos: [{ code: "A", business_name: "알파", address1: "서울시 중구", address2: "세종대로 1", latitude: Number.POSITIVE_INFINITY, longitude: 127, geocoding_status: "FAILED", geocoding_error: "주소 확인 필요" }],
    journals: [], laborOfficeDirectory: directory,
  });
  assert.deepEqual(issues.map((issue) => issue.type), ["주소 대비 좌표 없음", "지오코딩 명시 실패", "소재지지청 판정 불확실"]);
});

test("정합성 전체 결과에는 정상 행을 포함해 전체/이상건 필터가 실제로 구분된다", () => {
  const matchingDirectory = {
    offices: [{ office_code: "SEOUL", current_official_name: "서울지방고용노동청", current_short_name: "서울지청", jurisdiction_reference: "서울특별시 중구" }],
    aliases: [{ office_code: "SEOUL", business_office_name: "서울지청", document_office_name: "서울지청", mapping_note: "현재 관서 마스터에 직접 연결" }],
  };
  const rows = inspectMeasurementTargetIntegrity({
    targets: [{ code: "OK", business_name: "정상사업장", address: "서울특별시 중구 세종대로 1", office_jurisdiction: "서울", latitude: 37.56, longitude: 126.97 }],
    businessInfos: [{ code: "OK", business_name: "정상사업장", address1: "서울특별시 중구", address2: "세종대로 1", latitude: 37.56, longitude: 126.97, geocoding_status: "SUCCESS" }],
    journals: [], laborOfficeDirectory: matchingDirectory,
  });
  assert.deepEqual(rows.map((row) => [row.type, row.status]), [["정합성 이상 없음", "정상"]]);
});

test("K2B 재검증은 날짜와 내부 전송일을 함께 강제하고 상태 전이를 보수적으로 분류한다", () => {
  const exactTarget = { code: "A", businessName: "알파", resultDate: "2026-09-05", internalK2BStatus: "정상처리", internalK2BSendDate: "2026-09-05" };
  const [green] = reconcileK2BSubmissionResults([exactTarget], [{ companyName: "알파", status: "정상처리", submissionDate: "2026-09-05" }]);
  assert.equal(green.matchMethod, "name_and_date"); assert.equal(green.state, "GREEN");
  const [internalMismatch] = reconcileK2BSubmissionResults([{ ...exactTarget, internalK2BSendDate: "2026-09-04" }], [{ companyName: "알파", status: "정상처리", submissionDate: "2026-09-05" }]);
  assert.equal(internalMismatch.state, "YELLOW");
  const [remoteFailure] = reconcileK2BSubmissionResults([exactTarget], [{ companyName: "알파", status: "반려", submissionDate: "2026-09-05" }]);
  assert.equal(remoteFailure.state, "RED");
  const [notFound] = reconcileK2BSubmissionResults([exactTarget], []);
  assert.equal(notFound.state, "YELLOW");
  const [manualMissing] = reconcileK2BSubmissionResults([
    { code: "B", businessName: "수동처리", resultDate: "2026-09-05", internalK2BStatus: null, internalK2BSendDate: null },
  ], [{ companyName: "수동처리", status: "정상처리", submissionDate: "2026-09-05" }]);
  assert.equal(manualMissing.matchMethod, "name_and_date");
  assert.equal(manualMissing.state, "YELLOW");
  const [ambiguousManual] = reconcileK2BSubmissionResults([
    { code: "C", businessName: "중복후보", resultDate: "2026-09-05", internalK2BStatus: null, internalK2BSendDate: null },
  ], [
    { companyName: "중복후보", status: "정상처리", submissionDate: "2026-09-05" },
    { companyName: "중복후보", status: "정상처리", submissionDate: "2026-09-05" },
  ]);
  assert.equal(ambiguousManual.matchMethod, "AMBIGUOUS");
  assert.equal(ambiguousManual.match, null);
  const duplicateInternalCandidates = reconcileK2BSubmissionResults([
    { code: "D", businessName: "동일사업장", resultDate: "2026-09-05", internalK2BStatus: null, internalK2BSendDate: null },
    { code: "E", businessName: "동일사업장", resultDate: "2026-09-05", internalK2BStatus: null, internalK2BSendDate: null },
  ], [{ companyName: "동일사업장", status: "정상처리", submissionDate: "2026-09-05" }]);
  assert.deepEqual(duplicateInternalCandidates.map((item) => [item.matchMethod, item.match, item.state]), [
    ["AMBIGUOUS", null, "YELLOW"],
    ["AMBIGUOUS", null, "YELLOW"],
  ]);
  assert.equal(verificationFailureState("GREEN"), "STALE");
});

test("K2B 업로드는 공통 durable queue에만 등록하고 저장 오류는 호출자에게 전파한다", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const jobId = await enqueueSerializedK2BUpload({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: "job-1", error: null };
    },
  }, { targets: [{ code: "A" }] });
  assert.equal(jobId, "job-1");
  assert.deepEqual(calls, [{ name: "enqueue_k2b_upload_job", args: { p_payload: { targets: [{ code: "A" }] } } }]);
  await assert.rejects(
    requireK2BJournalPersistence(Promise.resolve({ error: new Error("DB write failed") })),
    /DB write failed/,
  );
});

test("KST 전일과 최근 미해결 검증 범위는 UTC 시차에 흔들리지 않는다", () => {
  assert.equal(getPreviousKSTCalendarDate("2026-01-01"), "2025-12-31");
  assert.equal(getPreviousKSTCalendarDate("2026-09-06"), "2026-09-05");
  assert.equal(getK2BVerifyUnresolvedSince("2026-09-05"), "2026-08-29");
});

test("새 K2B 검증은 날짜 필터 전용 경로와 업로드 직렬화/독립 필드를 사용한다", () => {
  const service = readFileSync("lib/automation/k2b-verification-service.ts", "utf8");
  const k2b = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const scheduler = readFileSync("lib/scheduler/background-tasks.ts", "utf8");
  const queue = readFileSync("app/api/report-processing/queue/route.ts", "utf8");
  const directUpload = readFileSync("app/api/report-processing/upload-k2b/route.ts", "utf8");
  const verifyRoute = readFileSync("app/api/report-processing/verify-k2b/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260906022850_add_k2b_verification_fields.sql", "utf8");
  const pilot = readFileSync("app/api/report-processing/verify-k2b/pilot/route.ts", "utf8");
  assert.match(service, /querySubmissionResultsForDate/); assert.doesNotMatch(service, /extractResults\(/);
  assert.match(k2b, /querySubmissionResultsForDate\(resultDate/); assert.match(k2b, /cal_fromdate_input/); assert.match(k2b, /cal_todate_input/); assert.match(k2b, /readOnlyMode/); assert.doesNotMatch(k2b, /stableIdentifier/);
  assert.match(worker, /job\.job_type === 'k2b_verify'/); assert.match(worker, /k2b_verification_attempted_at/); assert.match(worker, /\.gte\('k2b_send_date', unresolvedSince\)/); assert.match(worker, /\.lte\('k2b_send_date', resultDate\)/); assert.match(worker, /K2B_VERIFY_MANUAL_CANDIDATE_LIMIT/); assert.match(worker, /journalsBySendDate/); assert.match(worker, /requireK2BJournalPersistence/); assert.match(scheduler, /cron\.schedule\(K2B_VERIFY_SCHEDULE/);
  const verifyStart = worker.indexOf("private async processK2BVerifyJob");
  const failurePath = worker.slice(worker.indexOf("} catch (error: any) {", verifyStart), worker.indexOf("private async processK2BJob", verifyStart));
  assert.match(failurePath, /k2b_verification_error/); assert.doesNotMatch(failurePath, /k2b_verified_status:/);
  assert.match(migration, /k2b_verified_send_date/); assert.match(migration, /k2b_consistency_status/); assert.match(migration, /k2b_consistency_note/); assert.match(migration, /enqueue_k2b_automation_job/); assert.match(migration, /enqueue_k2b_upload_job/); assert.match(migration, /TO service_role/); assert.doesNotMatch(migration, /GRANT EXECUTE[^;]+authenticated/);
  assert.match(queue, /checkPermission\('journal:write'\)/); assert.match(queue, /createAdminClient/); assert.match(queue, /enqueueSerializedK2BUpload/); assert.match(directUpload, /enqueueSerializedK2BUpload/); assert.match(directUpload, /status: 202/); assert.doesNotMatch(directUpload, /K2BService/); assert.doesNotMatch(directUpload, /measurement_journal/); assert.match(verifyRoute, /checkPermission\("journal:write"\)/); assert.match(verifyRoute, /createAdminClient/); assert.match(scheduler, /createAdminClient/);
  assert.match(pilot, /MAX_PILOT_JOURNALS = 20/); assert.match(pilot, /remoteK2BReadExecuted: false/);
});
