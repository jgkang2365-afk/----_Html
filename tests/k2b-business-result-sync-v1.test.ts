import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertAdminK2BVerificationRange, buildGeneralK2BVerificationRange } from "../lib/automation/k2b-original-sync";
import { reconcileK2BSubmissionResults, statusToState } from "../lib/k2b-verification";
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
  const [oneKeyOnly] = reconcileK2BSubmissionResults([target], [{ managementNumber: "12345", commencementNumber: "99999", submissionDate: "2026-09-09", status: "정상처리" }]);
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

test("정상처리라도 오류보기가 있으면 오류이고 날짜 관련 verdict는 승인 대상으로 남긴다", () => {
  const [error] = reconcileK2BSubmissionResults([target], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리", errorViewAvailable: true }]);
  assert.equal(error.verdict, "오류");
  const [mismatch] = reconcileK2BSubmissionResults([{ ...target, internalK2BSendDate: "2026-09-08" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리" }]);
  assert.equal(mismatch.verdict, "날짜 불일치");
  const [errorBeforeDate] = reconcileK2BSubmissionResults([{ ...target, internalK2BSendDate: "2026-09-08" }], [{ managementNumber: "12345", commencementNumber: "00001", submissionDate: "2026-09-09", status: "정상처리", errorViewAvailable: true }]);
  assert.equal(errorBeforeDate.verdict, "오류");
  assert.equal(statusToState("정상처리", { internalK2BStatus: "정상처리", internalK2BSendDate: "2026-09-09", resultDate: "2026-09-09" }, true), "RED");
  assert.equal(statusToState("처리중", { internalK2BStatus: null, internalK2BSendDate: null, resultDate: "2026-09-09" }), "RED");
});

test("내부 전송일이 같은 정상·오류만 실제 처리상태를 자동 반영하고 승인 대상 날짜는 보존한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /const reflectActualStatus = \['정상', '오류'\]\.includes\(item\.verdict\)/);
  assert.match(worker, /journal\.k2b_send_date === item\.match\.submissionDate/);
  assert.match(worker, /\.\.\.\(reflectActualStatus \? \{ k2b_status: item\.match\.status \} : \{\}\)/);
  assert.match(worker, /날짜 불일치·내부 날짜 없음은 승인 endpoint까지 기존 값을 보존/);
});

test("일반 범위는 KST 오늘 포함 7일, 관리자 직접 범위는 최대 31일이다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.doesNotMatch(worker, /getK2BVerifyUnresolvedSince/);
  assert.match(worker, /gte\('k2b_send_date', verificationRange\.fromDate\)/);
  assert.match(worker, /lte\('k2b_send_date', verificationRange\.toDate\)/);
  assert.deepEqual(buildGeneralK2BVerificationRange("2026-09-09"), { fromDate: "2026-09-03", toDate: "2026-09-09" });
  assert.throws(() => assertAdminK2BVerificationRange("2026-08-01", "2026-09-01"), /OVER_31/);
  const verifyRoute = readFileSync("app/api/report-processing/verify-k2b/route.ts", "utf8");
  assert.match(verifyRoute, /assertAdminK2BVerificationRange/);
  assert.match(verifyRoute, /session\?\.role !== "관리자"/);
  assert.match(verifyRoute, /enqueue_k2b_automation_job/);
  const panel = readFileSync("components/features/K2BBusinessResultPanel.tsx", "utf8");
  assert.match(panel, /isAdmin &&/);
  assert.match(panel, /최대 31일 재검증/);
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
  assert.match(worker, /gr\.errorViewAvailable !== true/);

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
  assert.doesNotMatch(reportPage, /monitorJob\(body\.jobId, 'k2b_verify'\)/);
  assert.match(reportPage, /onExecutionFinished=/);
});
