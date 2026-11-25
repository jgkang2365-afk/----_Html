import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canAutomateNationalSupportForTargetStatus,
  readNationalSupportExecutionDecision,
  nationalSupportCompatibilityProjection,
} from "../lib/national-support/automation-contract";

test("Both active plan states pass the status gate regardless of whether the plan has a date", () => {
  assert.equal(canAutomateNationalSupportForTargetStatus("미실시"), true);
  assert.equal(canAutomateNationalSupportForTargetStatus("실시"), true);
  for (const status of ["거래종료", "완료", null, undefined, ""]) {
    assert.equal(canAutomateNationalSupportForTargetStatus(status), false);
  }
});

test("Worker checks current DB status rather than stale queued status", async () => {
  const database = {
    from(table: string) {
      assert.equal(table, "measurement_target_business");
      return {
        select(fields: string) {
          assert.equal(fields, "id,code,year,period,is_registered");
          return {
            eq(field: string, id: string | number) {
              assert.equal(field, "id");
              assert.equal(id, 17);
              return {
                maybeSingle: async () => ({ data: { id: 17, code: "H0557", year: 2026, period: "하반기", is_registered: "거래종료" }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(await readNationalSupportExecutionDecision(database as any,
    { target_id: 17, code: "H0557", year: 2026, period: "하반기" },
    { intent: "automatic", mode: "apply_if_missing", beforeApply: true }),
  { action: "skip", resultCode: "TARGET_STATUS_SKIP" });
});

test("Worker fails closed when status lookup errors or returns no row", async () => {
  const makeClient = (response: any) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => response }) }) }),
  });
  const read = (response: unknown) => readNationalSupportExecutionDecision(makeClient(response) as any,
    { target_id: 12, code: "H0557", year: 2026, period: "하반기" },
    { intent: "automatic", mode: "apply_if_missing", beforeApply: true });
  await assert.rejects(read({ data: null, error: null }), /TARGET_KEY_MISMATCH/);
  await assert.rejects(read({ data: null, error: new Error("DB unavailable") }), /DB unavailable/);
});

test("Skipped closed targets do not become confirmed non-support", () => {
  const projection = nationalSupportCompatibilityProjection("TARGET_STATUS_SKIP");
  assert.equal(projection.sync_status, "확인대기");
  assert.equal((projection as any).national_support_status, undefined);
});

test("Scheduler and both worker guard boundaries check live status", () => {
  const root = process.cwd();
  const scheduler = readFileSync(path.join(root,"lib/scheduler/background-tasks.ts"),"utf8");
  const worker = readFileSync(path.join(root,"lib/automation/local-automation-worker.ts"),"utf8");
  assert.match(scheduler,/\.in\('is_registered', \['미실시', '실시'\]\)/);
  assert.match(scheduler,/await readNationalSupportExecutionDecision\(admin,/);
  assert.equal((worker.match(/readNationalSupportExecutionDecision\(supabase, payload,/g)||[]).length,3);
  assert.equal((worker.match(/beforeApply: true/g)||[]).length,2);
});


test("Dedicated host opt-in prevents development Next servers from scheduling or running portal tasks", () => {
  const root = process.cwd();
  const scheduler = readFileSync(path.join(root,"lib/scheduler/background-tasks.ts"),"utf8");
  const worker = readFileSync(path.join(root,"lib/automation/local-automation-worker.ts"),"utf8");
  assert.match(scheduler,/process\.env\.NATIONAL_SUPPORT_WORKER_ENABLED !== "true"/);
  assert.match(worker,/process\.env\.NATIONAL_SUPPORT_WORKER_ENABLED !== "true"/);
});
