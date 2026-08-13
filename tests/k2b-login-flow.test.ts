import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { WebDriver, WebElement } from "selenium-webdriver";
import { closeExistingK2BLoginPopups } from "../lib/automation/k2b-service";

type LoginPopupDriver = Pick<WebDriver, "findElements">;

function createPopupDriver(popupCounts: number[]) {
  const clicks: number[] = [];
  let findCallCount = 0;

  const driver = {
    async findElements() {
      const popupCount = popupCounts[findCallCount++] ?? 0;
      return Array.from({ length: popupCount }, (_, index) => ({
        async click() {
          clicks.push(index);
        },
      })) as WebElement[];
    },
  } as LoginPopupDriver;

  return { driver, clicks, getFindCallCount: () => findCallCount };
}

test("로그인 팝업이 없으면 두 선택자를 즉시 확인하고 대기 없이 진행한다", async () => {
  const { driver, clicks, getFindCallCount } = createPopupDriver([0, 0]);

  const closedCount = await closeExistingK2BLoginPopups(driver);

  assert.equal(closedCount, 0);
  assert.equal(getFindCallCount(), 2);
  assert.deepEqual(clicks, []);
});

test("로그인 팝업이 있으면 발견된 팝업만 닫는다", async () => {
  const { driver, clicks, getFindCallCount } = createPopupDriver([1, 1]);

  const closedCount = await closeExistingK2BLoginPopups(driver);

  assert.equal(closedCount, 2);
  assert.equal(getFindCallCount(), 2);
  assert.deepEqual(clicks, [0, 0]);
});

test("로그인 입력 전에는 고정 sleep이나 팝업별 wait를 사용하지 않는다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const popupHelperStart = source.indexOf("export async function closeExistingK2BLoginPopups");
  const popupHelperEnd = source.indexOf("type FileDialogDiagnosticContext", popupHelperStart);
  const loginStart = source.indexOf("async login(id?: string, pw?: string)");
  const loginInputEnd = source.indexOf("// 로그인 성공 확인", loginStart);
  const popupHelper = source.slice(popupHelperStart, popupHelperEnd);
  const loginInputFlow = source.slice(loginStart, loginInputEnd);

  assert.notEqual(popupHelperStart, -1);
  assert.notEqual(popupHelperEnd, -1);
  assert.notEqual(loginStart, -1);
  assert.notEqual(loginInputEnd, -1);
  assert.match(popupHelper, /driver\.findElements\(By\.css\(selector\)\)/);
  assert.doesNotMatch(popupHelper, /\.wait\(|\.sleep\(/);
  assert.doesNotMatch(loginInputFlow, /\.sleep\(/);
  assert.match(loginInputFlow, /closeExistingK2BLoginPopups\(this\.driver\)/);
  assert.match(loginInputFlow, /until\.elementLocated[\s\S]*?20000[\s\S]*?idInput\.sendKeys/);
  assert.match(loginInputFlow, /until\.elementLocated[\s\S]*?20000[\s\S]*?pwInput\.sendKeys/);
  assert.match(loginInputFlow, /until\.elementLocated[\s\S]*?20000[\s\S]*?loginBtn\.click/);
});
