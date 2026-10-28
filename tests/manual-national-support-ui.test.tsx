import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
// jsdom은 런타임 의존성으로 이미 설치되어 있다. 테스트에서 필요한 DOM 타입만 명시한다.
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis };
};
import { MeasurementTargetBusinessFormSections } from "../components/features/MeasurementTargetBusinessFormSections";
import { EMPTY_MANUAL_NATIONAL_SUPPORT_INTENT } from "../lib/business/target-business-form";

function render(mode: "create" | "edit", isAdmin: boolean, period = "상반기") {
  return renderToStaticMarkup(React.createElement(MeasurementTargetBusinessFormSections, {
    mode,
    value: { period, business_name: "테스트 사업장", code: "TEST" },
    onChange: () => {},
    businessCategories: [],
    planManagerOptions: [],
    measurers: [],
    measurementDays: [],
    blockedKeys: new Set<string>(),
    onMeasurementDaysChange: () => {},
    isAdmin,
  }));
}

test("edit 모드에서는 일반 사용자와 관리자 모두 수동 수정 체크박스를 본다", () => {
  assert.match(render("edit", false), /수동 수정/);
  assert.match(render("edit", true), /수동 수정/);
});

test("create 모드 수동 수정은 관리자 전용으로 유지한다", () => {
  assert.doesNotMatch(render("create", false), /수동 수정/);
  assert.match(render("create", true), /수동 수정/);
});

test("수시 주기에서는 수동 수정 체크박스를 숨긴다", () => {
  assert.doesNotMatch(render("edit", false, "상반기(수시)"), /수동 수정/);
});

test("일반 사용자 edit에서 수동 수정 ON, 비대상 선택, OFF가 동작한다", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  function Form() {
    const [intent, setIntent] = React.useState(EMPTY_MANUAL_NATIONAL_SUPPORT_INTENT);
    return React.createElement(MeasurementTargetBusinessFormSections, {
      mode: "edit", value: { period: "상반기", business_name: "테스트 사업장", code: "TEST" },
      onChange: () => {}, businessCategories: [], planManagerOptions: [], measurers: [],
      measurementDays: [], blockedKeys: new Set<string>(), onMeasurementDaysChange: () => {},
      isAdmin: false, manualNationalSupportIntent: intent,
      onManualNationalSupportIntentChange: setIntent,
    });
  }
  try {
    await act(async () => { root.render(React.createElement(Form)); });
    const checkbox = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((input) => input.closest("label")?.textContent?.includes("수동 수정"));
    assert.ok(checkbox);
    await act(async () => { checkbox.click(); });
    const select = Array.from(container.querySelectorAll<HTMLSelectElement>("select"))
      .find((input) => Array.from(input.options).some((option) => option.value === "비대상"));
    assert.ok(select);
    await act(async () => {
      select.value = "비대상";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(select.value, "비대상");
    await act(async () => { checkbox.click(); });
    assert.equal(checkbox.checked, false);
    assert.equal(container.querySelector('select option[value="비대상"]'), null);
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, { window: oldWindow, document: oldDocument, IS_REACT_ACT_ENVIRONMENT: false });
    dom.window.close();
  }
});
