import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { NextRequest } from "next/server";
import ts from "typescript";

function loadModule(file: string, overrides: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => Object.hasOwn(overrides, name)
      ? overrides[name]
      : require(name.startsWith("@/") ? path.join(process.cwd(), name.slice(2)) : name),
    process, console, setTimeout, clearTimeout, URL,
  });
  return exports;
}

function isolatedFlow() {
  const target = {
    id: 754, code: "H0557", year: 2026, period: "하반기", is_registered: "실시",
    industrial_accident_number: "10000000001", commencement_number: "00000000000",
    manager_name: "김테스트", manager_mobile: "01098765432", representative_name: "박테스트",
    national_support_status: null, sync_status: "확인대기", sync_error_message: null,
  };
  const jobs: Record<string, any>[] = [];
  const scripts: string[] = [];
  let hasJournal = false;
  let race: "journal" | "closed" | null = null;

  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let update: Record<string, unknown> | undefined;
      const query = {
        select: () => query,
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        gt: () => query,
        order: () => query,
        update(value: Record<string, unknown>) { update = value; return query; },
        async maybeSingle() {
          if (table === "national_support_application") return { data: null, error: null };
          if (table === "business_info") return { data: { representative_name: target.representative_name }, error: null };
          assert.equal(table, "measurement_target_business");
          assert.equal(Number(filters.id), target.id);
          return { data: { ...target }, error: null };
        },
        single: () => query.maybeSingle(),
        async limit() {
          if (table === "automation_jobs") return { data: [], error: null };
          assert.equal(table, "measurement_journal");
          assert.deepEqual(filters, { code: "H0557", measurement_year: 2026, measurement_period: "하반기" });
          return { data: hasJournal ? [{ id: 1 }] : [], error: null };
        },
        then(resolve: (value: unknown) => void) {
          assert.equal(table, "measurement_target_business");
          assert.ok(update);
          Object.assign(target, update);
          resolve({ error: null });
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, any>) {
      switch (name) {
        case "enqueue_automation_job": {
          const job = { id: String(jobs.length + 1), status: "PENDING", target_key: args.p_target_key,
            request_payload: args.p_request_payload, requested_by: args.p_requested_by };
          jobs.push(job);
          return { data: job };
        }
        case "reconcile_stale_automation_jobs": return {};
        case "claim_next_automation_job": {
          const job = jobs.find(entry => entry.status === "PENDING");
          if (job) Object.assign(job, { status: "RUNNING", worker_id: args.p_worker_id });
          return { data: job ? [job] : [] };
        }
        case "update_automation_job_owned": {
          const job = jobs.find(entry => entry.id === args.p_job_id);
          assert.equal(job?.worker_id, args.p_worker_id);
          Object.assign(job!, args.p_fields);
          return { data: job };
        }
        case "complete_national_support_automation_job": {
          const job = jobs.find(entry => entry.id === args.p_job_id)!;
          assert.equal(job.worker_id, args.p_worker_id);
          assert.equal(args.p_target_id, target.id);
          Object.assign(job, { status: args.p_status, result_code: args.p_result_code });
          Object.assign(target, { sync_status: args.p_sync_status, sync_error_message: args.p_sync_error_message });
          return {};
        }
        default: throw new Error("Unexpected RPC " + name);
      }
    },
  };
  const mocks = {
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/auth/check-permission": { checkPermission: async () => {} },
    "@/lib/auth/get-user": { getUser: async () => ({ id: 104 }) },
    "@/lib/sync/master-tables": { syncToMasterTables: async () => {} },
  };

  // Real Node worker and guard protocol, with the external Python process replaced.
  const spawn = (_python: string, [script]: string[]) => {
    scripts.push(path.basename(script));
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    const send = (value: unknown) => child.stdout.emit("data", Buffer.from(JSON.stringify(value) + "\n"));
    const finish = (result: string) => { send({ status: "SUCCESS", result }); child.emit("close", 0); };
    let boundary = 0;
    queueMicrotask(() => {
      if (!script.endsWith("national_support_flow_cli.py")) return finish("NO_RESULT");
      send({ event: "journal_guard_before_apply" });
    });
    return Object.assign(child, {
      stdin: { writable: true, write(text: string) {
        const reply = JSON.parse(text);
        if (!reply.allow) {
          const codes: Record<string, string> = {
            JOURNAL_REGISTERED: "JOURNAL_REGISTERED_SKIP", TARGET_STATUS: "TARGET_STATUS_SKIP",
          };
          return finish(codes[reply.reason] || "GUARD_ERROR");
        }
        if (++boundary === 1) {
          if (race === "journal") hasJournal = true;
          if (race === "closed") target.is_registered = "거래종료";
          send({ event: "effect_started" });
        } else {
          throw new Error("Mock application boundary reached");
        }
      } },
    });
  };
  const processWorker = loadModule("lib/automation/national-support-worker.ts", {
    ...mocks, child_process: { spawn, spawnSync: () => assert.fail("Real subprocess is forbidden") },
  });
  const { LocalAutomationWorker } = loadModule("lib/automation/local-automation-worker.ts", {
    ...mocks, "@/lib/automation/national-support-worker": processWorker,
  });
  const { POST } = loadModule("app/api/businesses/national-support/apply/route.ts", mocks);
  const { GET } = loadModule("app/api/businesses/national-support/target-state/route.ts", mocks);
  return {
    target, jobs, scripts, setJournal: () => { hasJournal = true; },
    setRace: (value: typeof race) => { race = value; },
    request: async (intent: "direct" | "automatic", mode: "apply_if_missing" | "lookup_only" = "apply_if_missing") => {
      const response = await POST(new NextRequest("http://localhost/api/businesses/national-support/apply", {
        method: "POST", body: JSON.stringify({ code: target.code, year: target.year, period: target.period, target_id: target.id, intent, mode }),
      }));
      assert.equal(response.status, 200);
      return response.json();
    },
    drain: () => LocalAutomationWorker.getInstance().drain(),
    state: async () => (await (await GET(new NextRequest(
      "http://localhost/api/businesses/national-support/target-state?id=754&code=H0557&year=2026&period=" + encodeURIComponent("하반기"),
    ))).json()).state,
  };
}

test("H0557 실시·일지 없음은 API에서 Worker의 실제 조회 경로를 거쳐 terminal 상태를 반환한다", async () => {
  const flow = isolatedFlow();
  const result = await flow.request("automatic", "lookup_only");
  assert.equal(result.mode, "lookup_only");
  await flow.drain();
  assert.deepEqual(flow.scripts, ["apply_national_support_cli.py"]);
  assert.equal(flow.jobs[0].result_code, "LOOKUP_NO_RESULT");
  assert.equal((await flow.state()).sync_status, "조회대기");
  assert.equal(flow.target.national_support_status, null);
});

test("일지가 있으면 자동 enqueue를 차단하고 직접 요청은 조회만 수행한다", async () => {
  const flow = isolatedFlow();
  flow.setJournal();
  assert.equal((await flow.request("automatic")).resultCode, "JOURNAL_REGISTERED_SKIP");
  assert.equal(flow.jobs.length, 0);
  assert.equal((await flow.request("direct")).mode, "lookup_only");
  await flow.drain();
  assert.deepEqual(flow.scripts, ["apply_national_support_cli.py"]);
  assert.equal(flow.jobs[0].result_code, "LOOKUP_NO_RESULT");
});

test("조회 중 추가된 일지 또는 거래종료는 신청 marker 이전에 차단한다", async () => {
  for (const [race, code] of [["journal", "JOURNAL_REGISTERED_SKIP"], ["closed", "TARGET_STATUS_SKIP"]] as const) {
    const flow = isolatedFlow();
    assert.equal((await flow.request("automatic")).mode, "apply_if_missing");
    flow.setRace(race);
    await flow.drain();
    assert.deepEqual(flow.scripts, ["national_support_flow_cli.py"]);
    assert.equal(flow.jobs[0].result_code, code);
    assert.equal(flow.jobs[0].effect_started_at, undefined);
    assert.equal(flow.target.national_support_status, null);
  }
});
