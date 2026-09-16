import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  beginK2BPostUploadResult,
  finalizeK2BPostUploadResult,
  markK2BGridConfirmationFailure,
} from "../lib/automation/k2b-post-upload-result";

const uploaded = () => beginK2BPostUploadResult({
  code: "A-1",
  companyName: "테스트 사업장",
  year: 2026,
  period: "하반기",
  uploadSucceeded: true,
  uploadStatus: "업로드 완료",
});

test("v4 Test1: uploadReport 성공은 Grid 확정 전 final success가 아니다", () => {
  const result = uploaded();
  assert.equal(result.uploadSucceeded, true);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
  assert.equal(result.status, "결과 확인 필요");
});

test("v4 Test2: post-upload Grid reader throw는 실행 성공을 결과 확인 필요로만 남긴다", () => {
  const result = markK2BGridConfirmationFailure(uploaded(), "K2B 접수현황 Grid 확인 실패: timeout");
  assert.equal(result.uploadSucceeded, true);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
  assert.equal(result.status, "결과 확인 필요");
  assert.equal(result.failureStage, "grid-confirmation");
  assert.match(result.error || "", /Grid 확인 실패/);
});

test("v4 Test3: final success는 COMPLETE·exact canonical·latest NORMAL을 모두 요구한다", () => {
  const result = finalizeK2BPostUploadResult(uploaded(), {
    gridComplete: true,
    exactCanonicalMatch: true,
    latestNormal: true,
    status: "정상처리",
  });
  assert.equal(result.gridConfirmedNormal, true);
  assert.equal(result.success, true);
});

test("v4 Test4: COMPLETE여도 exact canonical 또는 latest NORMAL이 아니면 final success가 아니다", () => {
  for (const input of [
    { gridComplete: true, exactCanonicalMatch: false, latestNormal: true },
    { gridComplete: true, exactCanonicalMatch: true, latestNormal: false },
    { gridComplete: false, exactCanonicalMatch: true, latestNormal: true },
  ]) {
    const result = finalizeK2BPostUploadResult(uploaded(), input);
    assert.equal(result.gridConfirmedNormal, false);
    assert.equal(result.success, false);
  }
});

test("v4 Test5: upload 실패 target은 과거 Grid 정상처럼 보여도 final success가 될 수 없다", () => {
  const failedUpload = beginK2BPostUploadResult({
    code: "A-1",
    companyName: "테스트 사업장",
    year: 2026,
    period: "하반기",
    uploadSucceeded: false,
    uploadStatus: "업로드 실패",
  });
  const result = finalizeK2BPostUploadResult(failedUpload, {
    gridComplete: true,
    exactCanonicalMatch: true,
    latestNormal: true,
    status: "정상처리",
  });
  assert.equal(result.uploadSucceeded, false);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
});

test("v4 실행 경로는 upload 결과와 Grid 확정을 분리하고 reader 실패 target의 calendar sync를 막는다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /beginK2BPostUploadResult/);
  assert.match(worker, /uploadSucceeded: uploadRes\.success/);
  assert.match(worker, /if \(!uploadResult\?\.uploadSucceeded\) continue/);
  assert.match(worker, /finalizeK2BPostUploadResult\(uploadResult/);
  assert.match(worker, /markK2BGridConfirmationFailure\(results\[resultIndex\], confirmationError\)/);
  assert.match(worker, /if \(calendarSyncDecision\.shouldSync\)/);
});
