import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isSingleNationalSupportRepresentative } from "../lib/national-support/eligibility";
import { nationalSupportCompatibilityProjection } from "../lib/national-support/automation-contract";

test("Single representative is eligible, composite values are never split or auto-applied", () => {
  for (const name of ["홍길동", "김 철수", "Hong Gil Dong"]) {
    assert.equal(isSingleNationalSupportRepresentative(name), true, name);
  }
  for (const name of ["홍길동, 백두산", "홍길동/백두산", "김주봉 외 1명", "홍길동 및 백두산", " ", null]) {
    assert.equal(isSingleNationalSupportRepresentative(name), false, String(name));
  }
});
test("Multiple representative review cannot finalize national support status", () => {
  const projected = nationalSupportCompatibilityProjection("REPRESENTATIVE_REVIEW_SKIP");
  assert.equal(projected.sync_status, "확인대기");
  assert.equal((projected as any).national_support_status, undefined);
});
test("Scheduled and direct application paths both gate ambiguous representatives", () => {
  const scheduler = readFileSync(path.join(process.cwd(),"lib/scheduler/background-tasks.ts"),"utf8");
  const worker = readFileSync(path.join(process.cwd(),"lib/automation/national-support-worker.ts"),"utf8");
  assert.match(scheduler,/isSingleNationalSupportRepresentative\(representative\) && hasNationalSupportApplicationInformation/);
  assert.match(worker,/if \(!isSingleNationalSupportRepresentative\(payload.representative\)\)/);
  assert.match(worker,/REPRESENTATIVE_REVIEW_SKIP/);
});
