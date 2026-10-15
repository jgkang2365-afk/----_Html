import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

const requireLocal = createRequire(import.meta.url);
const source = readFileSync("components/features/K2BUnmatchableErrorsPanel.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

test("K2B 원본 패널은 관리자에게 원본과 승인 상태를 보이고 사유 입력 후 해당 ID만 승인한다", async () => {
  const { JSDOM } = requireLocal("jsdom");
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/", pretendToBeVisual: true,
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const { createRoot } = requireLocal("react-dom/client") as typeof import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const requests: { method: string; body?: { errorId: string; reason: string } }[] = [];
  let passed = false;
  const row = {
    id: "11111111-1111-4111-8111-111111111111", actual_submission_date: "2026-09-23",
    file_name: "fixture.xml", k2b_status: "파일오류", error_detail: "원본 오류",
    raw_row: { 파일명: "fixture.xml" }, first_seen_at: "2026-09-23T00:00:00Z",
    last_seen_at: "2026-10-15T00:00:00Z", submitter_user_id: null, submitter_name: null,
    review_state: "WAITING", approved_by_name: null, approved_at: null, approval_reason: null,
    approval_history: [],
  };
  const fetchMock = async (_input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "POST") { passed = true; return new Response(JSON.stringify({ approval: { disposition: "passed" } })); }
    return new Response(JSON.stringify({ errors: [{ ...row, review_state: passed ? "PASSED" : "WAITING" }] }));
  };
  const exports: { K2BUnmatchableErrorsPanel?: React.ComponentType<{ refreshKey: string | null }> } = {};
  runInNewContext(compiled, {
    exports, URLSearchParams, fetch: fetchMock, document: dom.window.document, window: dom.window,
    require: (id: string) => {
      if (id === "@/hooks/use-user") return { useUser: () => ({ user: { id: 1, role: "관리자" } }) };
      if (id === "sonner") return { toast: { success() {}, error() {} } };
      return requireLocal(id.startsWith("@/") ? resolve(id.slice(2)) : id);
    },
  });
  try {
    await React.act(async () => root.render(React.createElement(exports.K2BUnmatchableErrorsPanel!, { refreshKey: null })));
    const document = dom.window.document as Document;
    assert.match(document.body.textContent ?? "", /fixture\.xml/);
    assert.match(document.body.textContent ?? "", /확인 대기/);
    const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === label);
    await React.act(async () => button("패스 처리")!.click());
    assert.equal((button("패스 승인") as HTMLButtonElement).disabled, true);
    const textarea = document.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
    await React.act(async () => {
      setter.call(textarea, "관리자 확인");
      textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await React.act(async () => button("패스 승인")!.click());
    assert.deepEqual(requests.find((request) => request.method === "POST")?.body,
      { errorId: row.id, reason: "관리자 확인" });
    assert.match(document.body.textContent ?? "", /패스 완료/);
    assert.equal(button("패스 처리"), undefined);
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
