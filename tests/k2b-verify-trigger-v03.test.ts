import assert from "node:assert/strict";
import test from "node:test";
import { resolveK2BVerifyTrigger } from "../lib/automation/worker-daemon";

test("K2B 검증 trigger는 payload.trigger만으로 판정하고 requestedBy를 추론에 사용하지 않는다", () => {
  assert.equal(resolveK2BVerifyTrigger({ trigger: "scheduled", requestedBy: null }), "scheduled");
  assert.equal(resolveK2BVerifyTrigger({ trigger: "manual", requestedBy: "user-1" }), "manual");
  assert.equal(resolveK2BVerifyTrigger({ requestedBy: null }), "unknown");
  assert.equal(resolveK2BVerifyTrigger({ requestedBy: "user-1" }), "unknown");
});
