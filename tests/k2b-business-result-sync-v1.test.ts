import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertAdminK2BVerificationRange, buildGeneralK2BVerificationRange, buildK2BStaleCutoff, buildK2BSyncRange, isK2BStaleCandidate, shouldSweepK2BStale } from "../lib/automation/k2b-original-sync";
import { deriveK2BReconciliationUpdate, deriveK2BStaleUpdate, K2B_STALE_NOTICE, reconcileK2BSubmissionResults, shouldReflectActualK2BStatus } from "../lib/k2b-verification";
import { selectStoredK2BVerificationApprovalRows } from "../lib/automation/k2b-verification-approval";

const target = { journalId: 1, code: "A", businessName: "동명이인", resultDate: "2026-09-09", industrialAccidentNumber: "123-45", commencementNumber: "00001", internalK2BStatus: "정상처리", internalK2BSendDate: "2026-09-09" };

test("K2B 자동 매핑은 사업장명/날짜가 아니라 산재관리번호+개시번호 exact 한 건만 허용한다", () => {
  const [exact] = reconcileK2BSubmissionResults([target], [{ companyName: "전혀 다른 이름", managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" }]);
  assert.equal(exact.matchMethod, "exact_keys"); assert.equal(exact.verdict, "정상"); assert.equal(exact.state, "GREEN");
  const [missing] = reconcileK2BSubmissionResults([{ ...target, industrialAccidentNumber: null }], []);
  assert.equal(missing.matchMethod, "MISSING_KEY"); assert.equal(missing.verdict, "확인 필요");
  const [duplicate] = reconcileK2BSubmissionResults([target], [
    { managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" },
    { managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" },
  ]);
  assert.equal(duplicate.matchMethod, "AMBIGUOUS");
  const [oneKeyOnly] = reconcileK2BSubmissionResults([target], [{ managementNumber: "12345", commencementNumber: "99999", submissionDate: "2026-09-09", status: "정상처리" }], { completeness: "COMPLETE" });
  assert.equal(oneKeyOnly.verdict, "미접수");
  const [normalAfterError] = reconcileK2BSubmissionResults([target], [
    { managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-08", status: "파일오류" },
    { managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" },
  ]);
  assert.equal(normalAfterError.verdict, "정상");
  const [errorsOnly] = reconcileK2BSubmissionResults([target], [
    { managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-08", status: "파일오류" },
    { managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "체크오류" },
  ]);
  assert.equal(errorsOnly.verdict, "오류");
});

test("정상처리라도 실제 오류 신호가 있으면 오류이고 날짜 관련 verdict는 승인 대상으로 남긴다", () => {
  const [error] = reconcileK2BSubmissionResults([target], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리", errorViewAvailable: true }]);
  assert.equal(error.verdict, "오류");
  const [mismatch] = reconcileK2BSubmissionResults([{ ...target, internalK2BSendDate: "2026-09-08" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" }]);
  assert.equal(mismatch.verdict, "날짜 불일치");
  const [errorBeforeDate] = reconcileK2BSubmissionResults([{ ...target, internalK2BSendDate: "2026-09-08" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리", errorViewAvailable: true }]);
  assert.equal(errorBeforeDate.verdict, "오류");
  const [uploadedInternally] = reconcileK2BSubmissionResults([{ ...target, internalK2BStatus: "업로드 완료" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" }]);
  assert.equal(uploadedInternally.state, "GREEN");
});

test("내부 전송일이 같은 실제 상태만 자동 반영하고 오류내용만 있는 정상 문자열은 보존한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /deriveK2BReconciliationUpdate\(item, \{ internalK2BSendDate: journal\.k2b_send_date/);
  const [normal] = reconcileK2BSubmissionResults([{ ...target, internalK2BStatus: "업로드 완료" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" }]);
  assert.equal(shouldReflectActualK2BStatus(normal), true);
  const [normalWithError] = reconcileK2BSubmissionResults([target], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리", errorDetail: "실제 오류" }]);
  assert.equal(normalWithError.state, "RED");
  assert.equal(shouldReflectActualK2BStatus(normalWithError), false);
});

test("일반 범위는 KST 오늘 포함 7일, 관리자 직접 범위는 최대 31일이다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.doesNotMatch(worker, /getK2BVerifyUnresolvedSince/);
  assert.match(worker, /gte\('k2b_send_date', verificationRange\.fromDate\)/);
  assert.match(worker, /lte\('k2b_send_date', verificationRange\.toDate\)/);
  assert.deepEqual(buildGeneralK2BVerificationRange("2026-09-09"), { fromDate: "2026-09-03", toDate: "2026-09-09" });
  assert.deepEqual(assertAdminK2BVerificationRange("2026-08-10", "2026-09-09"), { fromDate: "2026-08-10", toDate: "2026-09-09" });
  assert.throws(() => assertAdminK2BVerificationRange("2026-08-01", "2026-09-01"), /OVER_31/);
  const verifyRoute = readFileSync("app/api/report-processing/verify-k2b/route.ts", "utf8");
  assert.match(verifyRoute, /assertAdminK2BVerificationRange/);
  assert.match(verifyRoute, /session\?\.role !== "관리자"/);
  assert.match(verifyRoute, /enqueue_k2b_automation_job/);
  const panel = readFileSync("components/features/K2BBusinessResultPanel.tsx", "utf8");
  assert.match(panel, /isAdmin && <Button[^>]*aria-expanded=\{adminRangeOpen\}/);
  assert.match(panel, /isAdmin && adminRangeOpen &&/);
  assert.match(panel, /관리자 기간 재검증/);
  assert.match(panel, /최대 31일 재검증/);
});

test("scheduled 원본 동기화는 완료된 최근 7일과 cursor catch-up을 합친다", () => {
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-16", lastSuccessfulThroughDate: "2026-09-15" }), { fromDate: "2026-09-09", toDate: "2026-09-15" });
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-16", lastSuccessfulThroughDate: "2026-09-01" }), { fromDate: "2026-09-02", toDate: "2026-09-15" });
  assert.deepEqual(buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-16" }), { fromDate: "2026-09-09", toDate: "2026-09-15" });
});

test("canonical scope까지 같은 receipt만 자동 확정하고 결과 행 순서에 의존하지 않는다", () => {
  const scoped = { ...target, measurementYear: 2026, measurementPeriod: "하반기", internalK2BStatus: "업로드 완료" };
  const error = { managementNumber: "12345", commencementNumber: "00001", businessYear: "2026", half: "하반기", submissionDate: "2026-09-09", status: "오류" };
  const normal = { ...error, status: "정상처리" };
  const [forward] = reconcileK2BSubmissionResults([scoped], [error, normal]);
  const [reverse] = reconcileK2BSubmissionResults([scoped], [normal, error]);
  assert.deepEqual([forward.state, forward.verdict, reverse.state, reverse.verdict], ["GREEN", "정상", "GREEN", "정상"]);
  const olderError = { ...error, submissionDate: "2026-09-08", status: "파일오류" };
  const newerError = { ...error, submissionDate: "2026-09-09", status: "반려" };
  const [errorForward] = reconcileK2BSubmissionResults([scoped], [olderError, newerError]);
  const [errorReverse] = reconcileK2BSubmissionResults([scoped], [newerError, olderError]);
  assert.deepEqual([errorForward.match?.status, errorReverse.match?.status], ["반려", "반려"]);
  const [differentPeriod] = reconcileK2BSubmissionResults([scoped], [{ ...normal, half: "상반기" }], { completeness: "COMPLETE" });
  assert.equal(differentPeriod.state, "YELLOW");
});

test("공통 반영 helper는 정상·실제오류·날짜불일치의 내부 상태 쓰기 정책을 구분한다", () => {
  const journal = { internalK2BSendDate: "2026-09-09", k2bStatus: "업로드 완료" };
  const [green] = reconcileK2BSubmissionResults([{ ...target, internalK2BStatus: "업로드 완료" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" }]);
  const greenUpdate = deriveK2BReconciliationUpdate(green, journal, "2026-09-09T01:00:00+09:00");
  assert.equal(greenUpdate.k2b_status, "정상처리");
  assert.equal(greenUpdate.k2b_verified_status, "GREEN");
  const [remoteError] = reconcileK2BSubmissionResults([target], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "반려" }]);
  assert.equal(deriveK2BReconciliationUpdate(remoteError, journal, "now").k2b_status, "반려");
  const [normalWithError] = reconcileK2BSubmissionResults([target], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리", errorDetail: "실제 오류" }]);
  assert.equal(deriveK2BReconciliationUpdate(normalWithError, journal, "now").k2b_status, undefined);
  const [mismatch] = reconcileK2BSubmissionResults([{ ...target, internalK2BSendDate: "2026-09-08" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" }]);
  assert.equal(deriveK2BReconciliationUpdate(mismatch, { ...journal, internalK2BSendDate: "2026-09-08" }, "now").k2b_status, undefined);
});

test("STALE cutoff는 수동 1일 range와 무관하며 scheduled에만 전체 sweep을 허용한다", () => {
  const cutoff = buildK2BStaleCutoff("2026-09-16");
  assert.equal(cutoff, "2026-09-09");
  assert.equal(shouldSweepK2BStale("manual"), false);
  assert.equal(isK2BStaleCandidate("2026-09-10", "YELLOW", cutoff), false);
  assert.equal(isK2BStaleCandidate("2026-09-08", "YELLOW", cutoff), true);
  assert.equal(isK2BStaleCandidate("2026-09-08", "GREEN", cutoff), false);
});

test("오래된 cursor catch-up range와 독립된 canonical cutoff만 STALE 후보를 만든다", () => {
  const range = buildK2BSyncRange({ trigger: "scheduled", today: "2026-09-16", lastSuccessfulThroughDate: "2026-09-01" });
  const cutoff = buildK2BStaleCutoff("2026-09-16");
  assert.equal(range.fromDate, "2026-09-02");
  assert.equal(isK2BStaleCandidate("2026-09-08", "RED", cutoff), true);
  assert.equal(isK2BStaleCandidate("2026-09-09", "RED", cutoff), false);
});

test("STALE 전환은 기존 실제 오류 note를 보존하고 반복 실행해도 안내를 중복하지 않는다", () => {
  const existing = "K2B 실제결과 오류: 접수번호 불일치";
  const first = deriveK2BStaleUpdate(existing);
  assert.equal(first.k2b_verified_status, "STALE");
  assert.equal(first.k2b_consistency_status, "STALE");
  assert.equal(first.k2b_consistency_note, `${existing} ${K2B_STALE_NOTICE}`);
  const repeated = deriveK2BStaleUpdate(first.k2b_consistency_note);
  assert.equal(repeated.k2b_consistency_note, first.k2b_consistency_note);
  assert.equal(Object.keys(repeated).sort().join(","), "k2b_consistency_note,k2b_consistency_status,k2b_verified_status");
});

test("scheduled 원본 동기화는 7일을 지난 non-GREEN을 관측값 보존형 STALE로 전이한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /shouldSweepK2BStale\(trigger\)/);
  assert.match(worker, /buildK2BStaleCutoff\(getKSTDateString\(\)\)/);
  assert.match(worker, /\.lt\('k2b_send_date', staleCutoff\)/);
  assert.match(worker, /deriveK2BStaleUpdate\(journal\.k2b_consistency_note\)/);
  assert.doesNotMatch(worker, /\.lt\('k2b_send_date', range\.fromDate\)/);
  assert.match(worker, /k2b_verified_status\.is\.null,k2b_verified_status\.neq\.GREEN/);
});

test("승인은 client code/date/status가 아닌 저장 job verificationRows와 journal id만 사용한다", () => {
  const stored = { verificationRows: [{ journalId: 7, verdict: "날짜 불일치", actualStatus: "정상처리", actualSubmissionDate: "2026-09-08", errorViewAvailable: false }] };
  assert.deepEqual(selectStoredK2BVerificationApprovalRows(stored, [7, 7]), [{ journalId: 7, actualStatus: "정상처리", actualSubmissionDate: "2026-09-08" }]);
  assert.equal(selectStoredK2BVerificationApprovalRows({ verificationRows: [{ ...stored.verificationRows[0], errorViewAvailable: true }] }, [7]), null);
  assert.equal(selectStoredK2BVerificationApprovalRows({ verificationRows: [{ ...stored.verificationRows[0], verdict: "정상" }] }, [7]), null);
  const source = readFileSync("app/api/report-processing/approve-k2b-verification/route.ts", "utf8");
  assert.match(source, /const \{ jobId, journalIds \}/);
  assert.match(source, /selectStoredK2BVerificationApprovalRows/);
  assert.doesNotMatch(source, /const \{[^}]*status[^}]*\} = await request\.json/);
  assert.match(source, /k2b_send_date: row\.actualSubmissionDate/);
  assert.match(source, /k2b_status: row\.actualStatus/);
});

test("웹 upload route는 Selenium을 실행하지 않고 local worker queue로만 위임하며 대표계정만 사용한다", () => {
  const route = readFileSync("app/api/report-processing/upload-k2b/route.ts", "utf8");
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const currentUser = readFileSync("lib/auth/get-user.ts", "utf8");
  assert.match(route, /enqueueSerializedK2BUpload/); assert.doesNotMatch(route, /K2BService|\.login\(|\.init\(/);
  const service = readFileSync("lib/automation/k2b-service.ts", "utf8");
  assert.doesNotMatch(worker, /select\('name, k2b_id, k2b_pw'\)/); assert.match(worker, /k2b_sender = '대표계정'|k2b_sender: '대표계정'/);
  assert.match(service, /async login\(\)/); assert.match(service, /process\.env\.K2B_ID/); assert.match(service, /process\.env\.K2B_PW/);
  assert.doesNotMatch(service, /async login\(id\?: string, pw\?: string\)/);
  assert.match(worker, /readCurrentSubmissionResults/);
  assert.doesNotMatch(worker, /gr\.companyName\.includes/);
  assert.match(worker, /!hasK2BReceiptError\(gr\)/);

  assert.doesNotMatch(currentUser, /\bk2b_id\b|\bk2b_pw\b/);
});

test("실제결과 화면은 저장된 결과만 사용하고 활성·표시 중인 경우에만 30초 polling 및 그룹 승인한다", () => {
  const panel = readFileSync("components/features/K2BBusinessResultPanel.tsx", "utf8");
  assert.match(panel, /k2b-execution-status/);
  assert.match(panel, /execution\.verificationRows/);
  assert.match(panel, /document\.visibilityState === "visible"/);
  assert.match(panel, /window\.setInterval\(refreshWhenVisible, 30_000\)/);
  assert.match(panel, /Object\.entries\(selectedRows\.reduce/);
  assert.match(panel, /approve-k2b-verification/);
  assert.match(panel, /onExecutionFinished/);
  assert.match(panel, /산재관리번호/);
  assert.match(panel, /개시번호/);
  assert.match(panel, /현재 K2B 상태/);
  assert.match(panel, /K2B 실제 처리상태/);
  assert.doesNotMatch(panel, />\{execution\.queueStatus\}<\/span>/);
  const reportPage = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");
  // 재검증 job은 저장된 결과 패널 갱신을 위해 기존 공통 monitor를 사용한다.
  assert.match(reportPage, /monitorJob\(body\.jobId, 'k2b_verify'\)/);
  assert.match(reportPage, /onExecutionFinished=/);
});
