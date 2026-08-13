import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  replaceWindowsPathRoot,
  resolveWindowsDialogPath,
} from "../lib/automation/windows-file-path";
import { runWithSingleRetry } from "../lib/automation/k2b-service";

test("K2B 파일 선택 경로는 설정된 Z 루트를 UNC 루트로 변환한다", () => {
  const result = replaceWindowsPathRoot(
    "Z:\\data\\측정팀\\측정보고서\\2026년\\하반기\\업체\\data.txt",
    "Z:\\data\\측정팀\\측정보고서",
    "\\\\NAS\\reports"
  );

  assert.equal(result, "\\\\NAS\\reports\\2026년\\하반기\\업체\\data.txt");
});

test("K2B 파일 선택 경로는 Windows 매핑 드라이브를 자동으로 UNC 변환한다", () => {
  const result = resolveWindowsDialogPath("Z:\\data\\업체\\data.txt", {
    lookupMappedDrive: (driveName) =>
      driveName.toUpperCase() === "Z:" ? "\\\\Synology\\share" : null,
  });

  assert.equal(result, "\\\\Synology\\share\\data\\업체\\data.txt");
});

test("다른 저장소 경로와 UNC 경로는 변경하지 않는다", () => {
  assert.equal(
    replaceWindowsPathRoot("C:\\temp\\data.txt", "Z:\\data", "\\\\NAS\\reports"),
    "C:\\temp\\data.txt"
  );
  assert.equal(
    resolveWindowsDialogPath("\\\\NAS\\reports\\data.txt", {
      lookupMappedDrive: () => {
        throw new Error("UNC에는 매핑 조회를 호출하면 안 됩니다.");
      },
    }),
    "\\\\NAS\\reports\\data.txt"
  );
});

test("K2B Windows 10 파일 선택은 UI Automation 준비 상태와 단계별 오류를 사용한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /resolveWindowsDialogPath/);
  assert.match(source, /REPORT_STORAGE_UNC_ROOT/);
  assert.match(source, /'-Sta'/);
  assert.match(source, /UIAutomationClient/);
  assert.match(source, /AutomationId -eq '1148'/);
  assert.match(source, /ValuePattern/);
  assert.match(source, /InvokePattern/);
  assert.match(source, /Start-Sleep -Milliseconds 150/);
  assert.match(source, /K2B_FILE_DIALOG_NOT_FOUND/);
  assert.match(source, /K2B_FILE_INPUT_NOT_READY/);
  assert.match(source, /K2B_FILE_OPEN_TIMEOUT/);
  assert.doesNotMatch(source, /\[System\.Windows\.Forms\.SendKeys\]/);
  assert.match(source, /도면 파일 선택 오류/);
  assert.doesNotMatch(source, /execSync\(`powershell -command/);
});

test("파일 선택창은 창이 없거나 입력 컨트롤이 없으면 polling하고 준비되면 즉시 진행한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /\$sawDialog = \$sawDialog -or \$state\.DialogFound/);
  assert.match(source, /if \(\$state\.FileInput\) \{[\s\S]*?\$ready = \$state[\s\S]*?break/);
  assert.match(source, /while \(\$watch\.ElapsedMilliseconds -lt 5000\)/);
  assert.match(source, /if \(\$sawDialog\) \{ throw 'K2B_FILE_INPUT_NOT_READY' \}/);
});

test("첨부 제어는 첫 실패만 정리 후 한 번 재시도한다", async () => {
  const attempts: number[] = [];
  let cleanupCount = 0;

  const result = await runWithSingleRetry(
    async attempt => {
      attempts.push(attempt);
      if (attempt === 1) throw new Error("temporary");
      return "success";
    },
    async () => {
      cleanupCount++;
    }
  );

  assert.equal(result, "success");
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(cleanupCount, 1);
});

test("첨부 제어는 두 번째 실패 후 추가 재시도하지 않는다", async () => {
  let attemptCount = 0;

  await assert.rejects(
    runWithSingleRetry(async () => {
      attemptCount++;
      throw new Error("failed");
    }),
    /failed/
  );
  assert.equal(attemptCount, 2);
});
