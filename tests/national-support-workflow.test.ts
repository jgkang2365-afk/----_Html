import assert from "node:assert/strict";
import test from "node:test";
import {
  FINAL_LOOKUP_MAX_ATTEMPTS,
  activeNationalSupportJobKey,
  decideLookupAction,
  preserveFinalNationalSupportStatus,
} from "../lib/national-support/workflow";

test("apply_if_missing은 명확한 NO_RESULT에서만 신청한다", () => {
  assert.equal(decideLookupAction("apply_if_missing", "SUPPORT"), "final_support");
  assert.equal(decideLookupAction("apply_if_missing", "NON_SUPPORT"), "final_non_support");
  assert.equal(decideLookupAction("apply_if_missing", "STANDBY"), "wait");
  assert.equal(decideLookupAction("apply_if_missing", "NO_RESULT"), "apply");
  assert.equal(decideLookupAction("apply_if_missing", "FAIL"), "fail");
});

test("final_lookup의 대기와 결과 없음은 비대상으로 확정하지 않는다", () => {
  assert.equal(decideLookupAction("final_lookup", "STANDBY", 0), "retry");
  assert.equal(decideLookupAction("final_lookup", "NO_RESULT", 0), "retry");
  assert.equal(decideLookupAction("final_lookup", "STANDBY", FINAL_LOOKUP_MAX_ATTEMPTS), "manual");
});

test("빈값과 진행 상태는 기존 확정 국고 상태를 지우지 않는다", () => {
  assert.equal(preserveFinalNationalSupportStatus(undefined, "", "대상"), "대상");
  assert.equal(preserveFinalNationalSupportStatus(null, "비대상"), "비대상");
  assert.equal(preserveFinalNationalSupportStatus(null, ""), null);
});

test("동일 대상이라도 신청과 최종 조회 작업 키는 구분한다", () => {
  assert.equal(activeNationalSupportJobKey(10, "final_lookup"), activeNationalSupportJobKey(10, "final_lookup"));
  assert.notEqual(activeNationalSupportJobKey(10, "apply_if_missing"), activeNationalSupportJobKey(10, "final_lookup"));
});
