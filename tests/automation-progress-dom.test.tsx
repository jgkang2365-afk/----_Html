import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import type { AutomationJob } from "../lib/automation/jobs";

const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: { pretendToBeVisual: boolean; url: string }) => { window: Window & typeof globalThis };
};

test("실제 모달과 사업장 화면의 완료 반영", async t => {
  const jsdom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true, url: "http://localhost/" });
  const restore = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: jsdom.window, document: jsdom.window.document, localStorage: jsdom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true, React,
  })) {
    restore.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const jobClientPath = require.resolve("../lib/automation/job-client");
  require(jobClientPath);
  const moduleEntry = require.cache[jobClientPath]!;
  const originalExports = moduleEntry.exports;
  let job: AutomationJob | null = null;
  let signal: (() => void) | undefined;
  let reads = 0;
  moduleEntry.exports = {
    async fetchAutomationJob() { reads += 1; return job; },
    subscribeNationalSupportChanges() { return () => {}; },
    subscribeAutomationJob(_id: string, onChanged: () => void) {
      signal = onChanged;
      return () => { signal = undefined; };
    },
  };
  const Modal = require("../components/features/AutomationProgressModal").default;
  const container = document.getElementById("root")!;
  const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
  const root = createRoot(container);
  const result = (id: string, status: string) => ({
    id, status, progress_percent: status === "COMPLETED" ? 100 : 50, result_code: null,
  }) as AutomationJob;
  try {
    for (const mes of [true, false]) {
      let terminalCalls = 0;
      const id = mes ? "mes" : "document";
      job = result(id, "RUNNING");
      const props = { key: id, jobId: id, title: id, mes, processingMessage: "작업 중",
        onClose() {}, onTerminal() { terminalCalls += 1; } };
      await act(async () => root.render(<Modal {...props} />));
      job = result(id, "COMPLETED");
      await act(async () => signal?.());
      assert.match(container.textContent || "", /작업이 완료되었습니다/);
      assert.equal(terminalCalls, 0);
      const close = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "닫기");
      assert.ok(close);
      await act(async () => close.click());
      assert.equal(terminalCalls, 1);
    }

    let hiddenTerminal = 0;
    job = result("hidden", "RUNNING");
    await act(async () => root.render(<Modal key="hidden" jobId="hidden" title="문서" processingMessage="작업 중"
      visible={false} onClose={() => {}} onTerminal={() => { hiddenTerminal += 1; }} />));
    job = result("hidden", "COMPLETED");
    await act(async () => signal?.());
    assert.equal(hiddenTerminal, 1);
    assert.equal(container.querySelector("[role=dialog]"), null);

    const readsBeforeHealth = reads;
    const healthJob = { ...result("health", "COMPLETED"), result_code: "JOURNAL_REGISTERED_SKIP" };
    await act(async () => root.render(<Modal key="health" jobId="health" title="건강디딤돌"
      nationalSupport processingMessage="조회 중" onClose={() => {}}
      observedJob={{ job: healthJob, error: null }} />));
    assert.match(container.textContent || "", /자동 처리 제외/);
    assert.equal(signal, undefined);
    assert.equal(reads, readsBeforeHealth);

    await t.test("목록과 열린 상세가 새 결과를 반영하고 늦은 목록 응답과 미저장 비고를 보존한다", async () => {
      const userModulePath = require.resolve("../hooks/use-user");
      require(userModulePath);
      const userModule = require.cache[userModulePath]!;
      const originalHook = userModule.exports;
      const originalFetch = globalThis.fetch;
      userModule.exports = { useUser: () => ({ user: { id: "104", role: "사용자" } }) };
      const row = {
        id: 754, code: "H0557", year: 2026, period: "하반기", business_name: "합성 사업장",
        is_registered: "실시", is_registered_text: "실시", national_support_status: null,
        sync_status: "확인대기", sync_error_message: null, representative_name: "박테스트",
        industrial_accident_number: "10000000001", commencement_number: "00000000000", notes: "저장된 비고",
      };
      const other = { ...row, id: 755, code: "H0558", business_name: "다른 사업장" };
      let delayedList: (() => void) | undefined;
      let delayList = false;
      let targetStateReads = 0;
      globalThis.fetch = async input => {
        const url = new URL(String(input), "http://localhost");
        switch (url.pathname) {
          case "/api/businesses":
            if (delayList) return new Promise(resolve => {
              delayedList = () => resolve(Response.json({ businesses: [row, other] }));
            });
            return Response.json({ businesses: [row, other] });
          case "/api/businesses/geocode": return Response.json({ summary: {} });
          case "/api/users": return Response.json({ users: [] });
          case "/api/business-categories": return Response.json({ categories: [] });
          case "/api/user-schedule-blocks": return Response.json({ blocks: [] });
          case "/api/businesses/national-support/apply":
            return Response.json({ jobId: "health-row", mode: "lookup_only" });
          case "/api/businesses/national-support/target-state":
            targetStateReads += 1;
            assert.equal(url.searchParams.get("id"), "754");
            return Response.json({ state: { ...row, sync_status: "성공", national_support_status: "대상" } });
          default: throw new Error("Unexpected isolated browser request " + url.pathname);
        }
      };
      const { MeasurementTargetBusinessManagement } = require("../components/features/MeasurementTargetBusinessManagement");
      try {
        job = result("health-row", "RUNNING");
        await act(async () => root.render(<MeasurementTargetBusinessManagement />));
        const lookup = container.querySelector<HTMLButtonElement>('button[title="공단 결과 확인 및 DB 반영 조회 실행"]');
        assert.ok(lookup);
        await act(async () => lookup.click());
        const closeProgress = container.querySelector<HTMLButtonElement>('button[aria-label^="진행 화면 닫기"]');
        assert.ok(closeProgress);
        await act(async () => closeProgress.click());
        const manage = container.querySelector<HTMLButtonElement>('button[aria-label="합성 사업장 관리"]');
        assert.ok(manage);
        await act(async () => manage.click());
        const notes = document.querySelector("textarea");
        assert.ok(notes);
        await act(async () => {
          Object.getOwnPropertyDescriptor(jsdom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(notes, "미저장 비고");
          notes.dispatchEvent(new jsdom.window.Event("input", { bubbles: true }));
        });
        delayList = true;
        await act(async () => jsdom.window.dispatchEvent(new jsdom.window.Event("focus")));
        assert.ok(delayedList);
        job = { ...result("health-row", "COMPLETED"), result_code: "SUPPORT" };
        await act(async () => signal?.());
        assert.equal(targetStateReads, 1);
        assert.match(container.textContent || "", /대상 ✅/);
        assert.match(document.body.textContent || "", /현재 조회 상태:\s*대상/);
        assert.equal(notes.value, "미저장 비고");
        await act(async () => delayedList?.());
        assert.match(container.textContent || "", /대상 ✅/);
        assert.match(document.body.textContent || "", /현재 조회 상태:\s*대상/);
        assert.equal(notes.value, "미저장 비고");
        const otherRow = container.querySelector('button[aria-label="다른 사업장 관리"]')?.parentElement?.parentElement;
        assert.doesNotMatch(otherRow?.textContent || "", /대상 ✅/);
      } finally {
        await act(async () => root.render(null));
        globalThis.fetch = originalFetch;
        userModule.exports = originalHook;
      }
    });
  } finally {
    await act(async () => root.unmount());
    moduleEntry.exports = originalExports;
    for (const [key, value] of restore) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    jsdom.window.close();
  }
});
