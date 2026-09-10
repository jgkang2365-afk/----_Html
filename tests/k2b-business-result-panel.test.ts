import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

const requireLocal = createRequire(import.meta.url);
const source = readFileSync("components/features/K2BBusinessResultPanel.tsx", "utf8");
// Next 라우터/인증 hook만 격리한다. 패널과 공통 UI는 실제 React로 렌더·상호작용한다.
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const makeExecution = (verdicts = ["정상", "날짜 불일치", "오류"], queueStatus = "success") => ({
  runId: "fixture-job", queueStatus, workerFinishedAt: null, lastError: null as string | null,
  remoteRowCount: 999, matchCounts: { green: 999, yellow: 999, red: 999 },
  verificationRows: verdicts.map((verdict, index) => ({
    journalId: index + 1, code: `TEST-${index}`, businessName: `합성 사업장 ${index}`,
    industrialAccidentNumber: "31481904910", commencementNumber: "00000000000", verdict,
    actualStatus: verdict === "오류" ? "파일오류" : "정상처리", actualSubmissionDate: "2026-09-09",
    internalStatus: "정상처리", internalSubmissionDate: "2026-09-08", submissionNumber: `R-${index}`,
    errorViewAvailable: verdict === "오류", errorDetail: verdict === "오류" ? "합성 오류" : null,
    approvalRequired: verdict === "날짜 불일치" || verdict === "내부 전송일자 없음",
  })),
});

async function mountPanel(options: { admin?: boolean; execution?: ReturnType<typeof makeExecution> | null } = {}) {
  const { JSDOM } = requireLocal("jsdom");
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true });
  const document = dom.window.document as Document;
  const window = dom.window as Window;
  const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
  const setGlobal = (name: string, value: unknown) => {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  for (const [name, value] of Object.entries({ window, document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) setGlobal(name, value);
  const { createRoot } = requireLocal("react-dom/client") as typeof import("react-dom/client");
  const { act } = React;
  const container = document.getElementById("root")!;
  let root = createRoot(container);
  const requests: { url: string; method: string; body?: string }[] = [];
  let execution = options.execution === undefined ? makeExecution() : options.execution;
  let refreshKey: string | null = null;
  let queued = 0, approved = 0, finished = 0;
  const intervals = new Map<number, () => void>();
  const intervalDelays: number[] = [];
  let intervalId = 0;
  window.setInterval = ((callback: () => void, delay: number) => {
    intervalDelays.push(delay);
    intervals.set(++intervalId, callback);
    return intervalId;
  }) as typeof window.setInterval;
  window.clearInterval = (id: number | undefined) => { if (id !== undefined) intervals.delete(id); };
  setGlobal("fetch", async (input: string, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (String(input).startsWith("/api/report-processing/k2b-execution-status?")) return new Response(JSON.stringify({ execution }));
    if (input === "/api/report-processing/verify-k2b") return new Response(JSON.stringify({ jobId: "new-fixture-job" }));
    if (input === "/api/report-processing/approve-k2b-verification") return new Response(JSON.stringify({ applied: [2] }));
    throw new Error(`Unexpected test request: ${input}`);
  });
  const exports: { K2BBusinessResultPanel?: React.ComponentType<{
    refreshKey: string | null; onApproved: () => void; onExecutionFinished: () => void; onVerificationQueued: (jobId: string) => void;
  }> } = {};
  runInNewContext(compiled, {
    exports, URLSearchParams, fetch: globalThis.fetch, document, window,
    require: (id: string) => {
      if (id === "@/hooks/use-user") return { useUser: () => ({ user: { role: options.admin ? "관리자" : "사용자" } }) };
      if (id === "sonner") return { toast: { success() {}, error() {} } };
      return requireLocal(id.startsWith("@/") ? resolve(id.slice(2)) : id);
    },
  });
  const Panel = exports.K2BBusinessResultPanel!;
  const render = () => root.render(React.createElement(Panel, {
    refreshKey, onApproved: () => { approved++; }, onExecutionFinished: () => { finished++; },
    onVerificationQueued: (jobId) => { queued++; refreshKey = jobId; render(); },
  }));
  await act(async () => { render(); });
  const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent === label);
  const click = async (label: string) => {
    const node = button(label);
    assert.ok(node, `버튼 없음: ${label}`);
    assert.equal(node.disabled, false, `버튼 비활성: ${label}`);
    await act(async () => { node.click(); });
  };
  return {
    document, window, requests, intervals, intervalDelays, button, click,
    getCallbacks: () => ({ queued, approved, finished }),
    async setDate(index: number, value: string) {
      const input = document.querySelectorAll<HTMLInputElement>('input[type="date"]')[index];
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    },
    async select(label: string) {
      const input = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(node => node.getAttribute("aria-label") === label);
      assert.ok(input);
      await act(async () => { input.click(); });
    },
    async refresh(next: ReturnType<typeof makeExecution>, key: string) {
      execution = next; refreshKey = key;
      await act(async () => { render(); });
    },
    async changeVisibility(visibility: "visible" | "hidden") {
      await act(async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: visibility });
        document.dispatchEvent(new dom.window.Event("visibilitychange"));
      });
    },
    async tick() { await act(async () => { for (const callback of [...intervals.values()]) callback(); }); },
    async reenter() {
      await act(async () => { root.unmount(); });
      root = createRoot(container);
      await act(async () => { render(); });
    },
    async dispose() {
      await act(async () => { root.unmount(); });
      dom.window.close();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test("초기 접힘: 상세 table/버튼/관리자 날짜 DOM 없이 요약만 표시하고 toggle 요청은 0건", async (t) => {
  const panel = await mountPanel({ admin: true });
  t.after(() => panel.dispose());
  const toggle = panel.button("상세 보기")!;
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.document.getElementById(toggle.getAttribute("aria-controls")!)?.hidden, true);
  assert.equal(panel.document.querySelector("table"), null);
  assert.equal(panel.document.querySelector('input[type="date"]'), null);
  assert.equal(panel.button("관리자 기간 재검증"), undefined);
  assert.equal(panel.button("새로고침"), undefined);
  assert.equal(panel.button("선택 반영 (0)"), undefined);
  assert.equal(panel.document.querySelector('[aria-label="검증 결과 요약"]')?.textContent, "정상 1건 · 확인 필요 1건 · 오류 1건");
  const requests = panel.requests.length;
  await panel.click("상세 보기");
  assert.ok(panel.document.querySelector("table"));
  assert.equal(panel.button("접기")?.getAttribute("aria-expanded"), "true");
  await panel.click("접기");
  assert.equal(panel.document.querySelector("table"), null);
  assert.equal(panel.requests.length, requests);
  assert.deepEqual(panel.getCallbacks(), { queued: 0, approved: 0, finished: 0 });
  assert.equal(panel.window.localStorage.length, 0);
  assert.equal(panel.window.sessionStorage.length, 0);
});

test("일반 사용자는 상세 펼침에서도 관리자 기간 UI가 없다", async (t) => {
  const panel = await mountPanel();
  t.after(() => panel.dispose());
  await panel.click("상세 보기");
  assert.equal(panel.button("관리자 기간 재검증"), undefined);
  assert.equal(panel.document.querySelector('input[type="date"]'), null);
});

test("관리자 기간 UI는 상세 안에서 2차 펼침/기간 설정 닫기를 유지한다", async (t) => {
  const panel = await mountPanel({ admin: true });
  t.after(() => panel.dispose());
  await panel.click("상세 보기");
  assert.equal(panel.button("관리자 기간 재검증")?.getAttribute("aria-expanded"), "false");
  const requests = panel.requests.length;
  await panel.click("관리자 기간 재검증");
  assert.equal(panel.document.querySelectorAll('input[type="date"]').length, 2);
  const admin = panel.button("기간 설정 닫기")!;
  assert.ok(panel.document.getElementById(admin.getAttribute("aria-controls")!));
  await panel.click("기간 설정 닫기");
  assert.equal(panel.document.querySelector('input[type="date"]'), null);
  assert.equal(panel.requests.length, requests);
});

test("summary는 verificationRows verdict만 집계하고 나머지는 모두 확인 필요이다", async (t) => {
  const panel = await mountPanel({ execution: makeExecution(["정상", "오류", "날짜 불일치", "내부 전송일자 없음", "확인 필요", "미접수", "기타 yellow"]) });
  t.after(() => panel.dispose());
  assert.equal(panel.document.querySelector('[aria-label="검증 결과 요약"]')?.textContent, "정상 1건 · 확인 필요 5건 · 오류 1건");
  assert.equal(panel.requests.length, 1);
  assert.ok(panel.requests.every(request => request.method === "GET" && request.url.startsWith("/api/report-processing/k2b-execution-status?")));
  assert.doesNotMatch(source, /supabase|localStorage|sessionStorage/);
});

test("저장된 rows가 없으면 아직 저장 결과 없음으로 표시한다", async (t) => {
  const panel = await mountPanel({ execution: null });
  t.after(() => panel.dispose());
  assert.equal(panel.document.querySelector('[aria-label="검증 결과 요약"]')?.textContent, "아직 저장 결과 없음");
  await panel.refresh(makeExecution([]), "fixture-job");
  assert.equal(panel.document.querySelector('[aria-label="검증 결과 요약"]')?.textContent, "아직 저장 결과 없음");
});

test("접혀도 진행 상태와 visible-only 30초 polling을 유지하며 toggle은 polling을 재시작하지 않는다", async (t) => {
  const panel = await mountPanel({ execution: makeExecution([], "processing") });
  t.after(() => panel.dispose());
  assert.equal(panel.document.querySelector('[role="status"]')?.textContent, "검증 진행 중");
  assert.deepEqual(panel.intervalDelays, [30_000]);
  const initial = panel.requests.length;
  await panel.click("상세 보기"); await panel.click("접기");
  assert.equal(panel.requests.length, initial);
  assert.deepEqual(panel.intervalDelays, [30_000]);
  await panel.tick();
  assert.equal(panel.requests.length, initial + 1);
  await panel.changeVisibility("hidden");
  const hidden = panel.requests.length;
  await panel.tick();
  assert.equal(panel.requests.length, hidden);
  assert.equal(panel.intervals.size, 0);
  await panel.changeVisibility("visible");
  assert.equal(panel.intervals.size, 1);
  assert.ok(panel.intervalDelays.every(delay => delay === 30_000));
});

test("접기/펼치기 후 선택 상태와 승인 동작을 유지하고 새 페이지 진입은 다시 접힌다", async (t) => {
  const panel = await mountPanel();
  t.after(() => panel.dispose());
  await panel.click("상세 보기");
  await panel.select("합성 사업장 1 반영 선택");
  assert.ok(panel.button("선택 반영 (1)"));
  const requests = panel.requests.length;
  await panel.click("접기"); await panel.click("상세 보기");
  assert.equal(panel.requests.length, requests);
  assert.equal(panel.document.querySelector<HTMLInputElement>('[aria-label="합성 사업장 1 반영 선택"]')?.checked, true);
  await panel.click("선택 반영 (1)");
  assert.ok(panel.document.querySelector('[role="dialog"]'));
  await panel.click("1건 반영");
  assert.equal(panel.getCallbacks().approved, 1);
  assert.equal(panel.requests.filter(request => request.method === "POST").length, 1);
  assert.ok(panel.button("접기"));
  await panel.reenter();
  assert.equal(panel.button("상세 보기")?.getAttribute("aria-expanded"), "false");
});

test("상단/관리자 재검증의 새 refreshKey와 결과 수신이 상세 펼침을 초기화하지 않는다", async (t) => {
  const panel = await mountPanel({ admin: true });
  t.after(() => panel.dispose());
  await panel.click("상세 보기");
  await panel.refresh({ ...makeExecution([], "pending"), runId: "top-fixture-job" }, "top-fixture-job");
  assert.ok(panel.button("접기"));
  await panel.click("관리자 기간 재검증");
  await panel.setDate(0, "2026-09-03"); await panel.setDate(1, "2026-09-09");
  await panel.click("최대 31일 재검증");
  assert.equal(panel.getCallbacks().queued, 1);
  assert.equal(panel.requests.filter(request => request.url === "/api/report-processing/verify-k2b").length, 1);
  assert.ok(panel.button("접기"));
  assert.equal(panel.document.querySelector('input[type="date"]'), null);
});
