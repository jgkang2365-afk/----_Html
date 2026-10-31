import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(path.join(process.cwd(), "lib/automation/national-support-worker.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const windowsWorkerCwd = String.raw`C:\Users\PC\MeasurementJournal\app`;
const windowsPython = String.raw`C:\Users\PC\MeasurementJournal\app\.venv-national-support\Scripts\python.exe`;

function loadWorker(platform: string, venvExists: boolean, spawnError = false) {
  const commands: string[] = [];
  const scripts: string[] = [];
  const logs: string[] = [];
  const exports: Record<string, unknown> = {};
  const root = platform === "win32" ? windowsWorkerCwd : "/opt/measurement-journal/app";
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const spawn = (command: string, args: string[]) => {
    commands.push(command);
    scripts.push(args[0]);
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { writable: boolean; write: () => void };
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { writable: true, write: () => {} };
    queueMicrotask(() => {
      if (spawnError) child.emit("error", new Error("ENOENT"));
      else {
        child.stdout.emit("data", Buffer.from('{"status":"SUCCESS","result":"SUPPORT"}\n'));
        child.emit("close", 0);
      }
    });
    return child;
  };
  const requireMock = (name: string): unknown => {
    if (name === "child_process") return { spawn, spawnSync: () => {} };
    if (name === "fs") return { existsSync: (file: string) => venvExists && file === windowsPython };
    if (name === "path") return platformPath;
    if (name === "@/lib/supabase/server") return {
      createClient: async () => ({ from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) }),
    };
    if (name === "@/lib/national-support/workflow") return { FINAL_LOOKUP_DELAY_MS: 0, FINAL_LOOKUP_MAX_ATTEMPTS: 0 };
    if (name === "@/lib/national-support/eligibility") return {
      isValidNationalSupportContactName: () => true,
      isValidNationalSupportMobile: () => true,
    };
    if (name === "@/lib/national-support/automation-contract") return { hasMeasurementJournalForTarget: async () => false };
    throw new Error(`Unexpected import: ${name}`);
  };
  vm.runInNewContext(compiled, {
    exports,
    require: requireMock,
    process: { platform, cwd: () => root },
    console: { info: (message: string) => logs.push(message) },
    setTimeout,
    clearTimeout,
    Buffer,
  });
  return {
    processJob: exports.processNationalSupportJob as (payload: Record<string, unknown>) => Promise<unknown>,
    commands,
    scripts,
    logs,
    venvPython: windowsPython,
  };
}

const payload = {
  target_id: 1, sanjae: "", commencement: "", representative: "", period: "", code: "", year: 2026,
  mode: "lookup_only",
};

test("Windows에서 전용 venv가 있으면 그 Python으로 건강디딤돌 CLI를 실행한다", async () => {
  const worker = loadWorker("win32", true);
  assert.equal((await worker.processJob(payload) as { resultCode: string }).resultCode, "SUPPORT");
  assert.deepEqual(worker.commands, [worker.venvPython]);
  assert.ok(worker.scripts[0].endsWith("apply_national_support_cli.py"));
  assert.ok(worker.logs.some(log => log.includes(worker.venvPython)));
});

test("신청 통합 CLI도 동일한 전용 Python을 사용한다", async () => {
  const worker = loadWorker("win32", true);
  assert.equal((await worker.processJob({ ...payload, mode: "apply_if_missing" }) as { resultCode: string }).resultCode, "SUPPORT");
  assert.deepEqual(worker.commands, [worker.venvPython]);
  assert.ok(worker.scripts[0].endsWith("national_support_flow_cli.py"));
});

test("전용 venv가 없는 Windows와 Linux에서는 기존 python을 실행한다", async () => {
  for (const [platform, venvExists] of [["win32", false], ["linux", true]] as const) {
    const worker = loadWorker(platform, venvExists);
    assert.equal((await worker.processJob(payload) as { resultCode: string }).resultCode, "SUPPORT");
    assert.deepEqual(worker.commands, ["python"]);
  }
});

test("실행 실패에는 선택한 Python 경로가 포함된다", async () => {
  const worker = loadWorker("win32", true, true);
  await assert.rejects(worker.processJob(payload), error => {
    assert.match((error as Error).message, /Python 실행 실패/);
    assert.ok((error as Error).message.includes(worker.venvPython));
    return true;
  });
});
