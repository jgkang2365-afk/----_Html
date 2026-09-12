import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type FinalCode = "SUPPORT" | "NON_SUPPORT";
type Row = { code: string; year: number; period: string; status: string | null };
type State = {
  job: { status: "RUNNING" | "COMPLETED"; owner: string; resultCode: FinalCode | null };
  target: Row | null;
  application: Row | null;
  journals: Row[];
  masterProjected: boolean;
};

const fixture = (): State => ({
  job: { status: "RUNNING", owner: "worker-1", resultCode: null },
  target: { code: "A", year: 2026, period: "하반기", status: null },
  application: null,
  journals: [
    { code: "A", year: 2026, period: "하반기", status: null },
    { code: "A", year: 2025, period: "하반기", status: null },
    { code: "A", year: 2026, period: "상반기", status: null },
  ],
  masterProjected: false,
});

/** Transaction model for the SQL ownership/target/application/journal boundary. */
function finalize(state: State, code: FinalCode, owner: string, failAt?: "target" | "application" | "master") {
  const next = structuredClone(state);
  if (next.job.status !== "RUNNING" || next.job.owner !== owner) throw new Error("STALE_OWNER");
  next.job.status = "COMPLETED";
  next.job.resultCode = code;
  if (!next.target || failAt === "target") throw new Error("TARGET_FAILED");
  const status = code === "SUPPORT" ? "대상" : "비대상";
  next.target.status = status;
  if (failAt === "application") throw new Error("APPLICATION_FAILED");
  next.application = { code: "A", year: 2026, period: "하반기", status };
  for (const journal of next.journals) {
    if (journal.code === "A" && journal.year === 2026 && journal.period === "하반기") journal.status = status;
  }
  // Secondary master projection is outside the authoritative transaction.
  Object.assign(state, next);
  if (failAt === "master") return;
  state.masterProjected = true;
}

for (const [code, expected] of [["SUPPORT", "대상"], ["NON_SUPPORT", "비대상"]] as const) {
  test(`${code} 확정은 job·target·application·canonical journal을 함께 반영한다`, () => {
    const state = fixture();
    finalize(state, code, "worker-1");
    assert.equal(state.job.status, "COMPLETED");
    assert.equal(state.job.resultCode, code);
    assert.equal(state.target?.status, expected);
    assert.equal(state.application?.status, expected);
    assert.deepEqual(state.journals.map(row => row.status), [expected, null, null]);
  });
}

for (const failAt of ["target", "application"] as const) {
  test(`${failAt} 실패는 terminal과 모든 업무값을 롤백한다`, () => {
    const state = fixture();
    const before = structuredClone(state);
    assert.throws(() => finalize(state, "SUPPORT", "worker-1", failAt));
    assert.deepEqual(state, before);
  });
}

test("target 행이 없으면 job terminal도 롤백한다", () => {
  const state = fixture();
  state.target = null;
  const before = structuredClone(state);
  assert.throws(() => finalize(state, "SUPPORT", "worker-1"), /TARGET_FAILED/);
  assert.deepEqual(state, before);
});

test("stale worker는 결과를 확정할 수 없다", () => {
  const state = fixture();
  const before = structuredClone(state);
  assert.throws(() => finalize(state, "NON_SUPPORT", "old-worker"), /STALE_OWNER/);
  assert.deepEqual(state, before);
});

test("journal 행이 없어도 확정하고 master 보조 반영 실패는 확정값을 되돌리지 않는다", () => {
  const state = fixture();
  state.journals = [];
  finalize(state, "SUPPORT", "worker-1", "master");
  assert.equal(state.job.status, "COMPLETED");
  assert.equal(state.target?.status, "대상");
  assert.equal(state.application?.status, "대상");
  assert.equal(state.masterProjected, false);
});

test("실제 RPC 경계에 final upsert·journal canonical key·소유권·ACL이 포함된다", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"), "utf8");
  const sql = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.complete_national_support_automation_job"), migration.indexOf("REVOKE ALL ON FUNCTION public.complete_national_support_automation_job"));
  const flowSource = fs.readFileSync(path.join(process.cwd(), "lib/automation/national-support-worker.ts"), "utf8");
  const worker = fs.readFileSync(path.join(process.cwd(), "lib/automation/local-automation-worker.ts"), "utf8");
  assert.match(sql, /job\.worker_id=p_worker_id AND job\.status='RUNNING'/);
  assert.match(sql, /IF NOT FOUND THEN RAISE EXCEPTION 'NATIONAL_SUPPORT_TARGET_NOT_FOUND'/);
  assert.match(sql, /INSERT INTO public\.national_support_application/);
  assert.match(sql, /ON CONFLICT \(code, year, period\) DO UPDATE/);
  assert.match(sql, /WHERE code=completed\.request_payload->>'code'[\s\S]*measurement_year=[\s\S]*measurement_period=/);
  assert.doesNotMatch(flowSource, /persistFinalStatus|\.from\("national_support_application"\)|syncToMasterTables/);
  assert.match(worker, /await this\.completeTerminal\(job\.id, payload/);
  assert.match(worker, /await this\.projectFinalMaster\(payload\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.complete_national_support_automation_job[^\n]*FROM PUBLIC/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.complete_national_support_automation_job[^\n]*TO service_role/);
});
