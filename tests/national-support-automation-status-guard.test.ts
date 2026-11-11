import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canAutomateNationalSupportForTargetStatus,
  canAutomateNationalSupportForTarget,
  nationalSupportCompatibilityProjection,
} from "../lib/national-support/automation-contract";

test("Only not-yet-measured, active targets are eligible for automation", () => {
  assert.equal(canAutomateNationalSupportForTargetStatus("미실시"), true);
  for (const status of ["실시", "거래종료", "완료", null, undefined, ""]) {
    assert.equal(canAutomateNationalSupportForTargetStatus(status), false);
  }
});

test("Worker checks current DB status rather than stale queued status", async () => {
  const database = {
    from(table: string) {
      assert.equal(table, "measurement_target_business");
      return {
        select(fields: string) {
          assert.equal(fields, "is_registered");
          return {
            eq(field: string, id: string | number) {
              assert.equal(field, "id");
              assert.equal(id, 17);
              return {
                maybeSingle: async () => ({ data: { is_registered: "거래종료" }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  assert.equal(await canAutomateNationalSupportForTarget(database as any, 17), false);
});

test("Worker fails closed when status lookup errors or returns no row", async () => {
  const makeClient = (response: any) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => response }) }) }),
  });
  assert.equal(await canAutomateNationalSupportForTarget(makeClient({ data: null, error: null }) as any, 12), false);
  await assert.rejects(canAutomateNationalSupportForTarget(makeClient({ data: null, error: new Error("DB unavailable") }) as any, 12));
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
  assert.match(scheduler,/\.eq\('is_registered', '미실시'\)/);
  assert.match(worker,/!await canAutomateNationalSupportForTarget\(supabase, payload.target_id\)/);
  assert.equal((worker.match(/canAutomateNationalSupportForTarget\(supabase, payload.target_id\)/g)||[]).length,2);
});


test("Dedicated host opt-in prevents development Next servers from scheduling or running portal tasks", () => {
  const root = process.cwd();
  const scheduler = readFileSync(path.join(root,"lib/scheduler/background-tasks.ts"),"utf8");
  const worker = readFileSync(path.join(root,"lib/automation/local-automation-worker.ts"),"utf8");
  assert.match(scheduler,/process\.env\.NATIONAL_SUPPORT_WORKER_ENABLED !== "true"/);
  assert.match(worker,/process\.env\.NATIONAL_SUPPORT_WORKER_ENABLED !== "true"/);
});
