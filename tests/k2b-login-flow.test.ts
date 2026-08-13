import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { error, type WebDriver, type WebElement } from "selenium-webdriver";
import {
  closeExistingK2BLoginPopups,
  closeInitialK2BLoginPopups,
} from "../lib/automation/k2b-service";

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

test("초기 비동기 팝업은 두 선택자를 합산해 최대 2초 조건 대기 후 닫는다", async () => {
  const clicks: number[] = [];
  const waits: Array<{ timeout: number; pollTimeout: number }> = [];
  const popupCounts = [0, 0, 1, 1, 1];
  let findCallCount = 0;

  const driver = {
    async findElements() {
      const popupCount = popupCounts[findCallCount++] ?? 0;
      return Array.from({ length: popupCount }, () => ({
        async click() {
          clicks.push(1);
        },
      })) as WebElement[];
    },
    async wait(condition: (driver: WebDriver) => Promise<unknown>, timeout: number, _message: unknown, pollTimeout: number) {
      waits.push({ timeout, pollTimeout });
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await condition(driver as WebDriver)) return true;
      }
      throw new error.TimeoutError();
    },
  } as unknown as Pick<WebDriver, "findElements" | "wait">;

  const closedCount = await closeInitialK2BLoginPopups(driver);

  assert.equal(closedCount, 2);
  assert.deepEqual(waits, [{ timeout: 2000, pollTimeout: 100 }]);
  assert.deepEqual(clicks, [1, 1]);
});

test("초기 팝업이 없으면 2초 조건 대기 timeout을 정상 흐름으로 처리한다", async () => {
  let waitCallCount = 0;
  let findCallCount = 0;
  const driver = {
    async findElements() {
      findCallCount++;
      return [] as WebElement[];
    },
    async wait() {
      waitCallCount++;
      throw new error.TimeoutError();
    },
  } as unknown as Pick<WebDriver, "findElements" | "wait">;

  const closedCount = await closeInitialK2BLoginPopups(driver);

  assert.equal(closedCount, 0);
  assert.equal(waitCallCount, 1);
  assert.equal(findCallCount, 2);
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
  assert.match(popupHelper, /timeoutMs = 2000/);
  assert.match(popupHelper, /}, timeoutMs, undefined, 100\)/);
  assert.doesNotMatch(popupHelper, /\.sleep\(/);
  assert.doesNotMatch(loginInputFlow, /\.sleep\(/);
  assert.match(loginInputFlow, /closeInitialK2BLoginPopups\(this\.driver\)/);
  assert.match(loginInputFlow, /until\.elementLocated[\s\S]*?20000[\s\S]*?idInput\.sendKeys/);
  assert.match(loginInputFlow, /until\.elementLocated[\s\S]*?20000[\s\S]*?pwInput\.sendKeys/);
  assert.match(loginInputFlow, /until\.elementLocated[\s\S]*?20000[\s\S]*?loginBtn\.click/);
});
