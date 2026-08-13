import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  replaceWindowsPathRoot,
  resolveWindowsDialogPath,
} from "../lib/automation/windows-file-path";
import {
  areEquivalentWindowsDialogPaths,
  runWithSingleRetry,
} from "../lib/automation/k2b-service";

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

test("SetValue 후 실제 값이 비어 있으면 입력 성공으로 처리하지 않는다", () => {
  assert.equal(
    areEquivalentWindowsDialogPaths("Z:\\reports\\company\\data.txt", ""),
    false
  );
});

test("SetValue 후 일부 경로만 반영되면 입력 성공으로 처리하지 않는다", () => {
  assert.equal(
    areEquivalentWindowsDialogPaths(
      "Z:\\reports\\company\\data.txt",
      "Z:\\reports\\company"
    ),
    false
  );
});

test("SetValue 후 동등한 Windows 전체 경로가 반영되면 입력 성공으로 처리한다", () => {
  assert.equal(
    areEquivalentWindowsDialogPaths(
      "Z:\\reports\\company\\data.txt",
      '"z:/reports/company/data.txt"'
    ),
    true
  );
});

test("최초 값 미반영 후 polling에서 정상 반영되면 즉시 열기 단계로 진행한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const expected = "Z:\\reports\\company\\data.txt";
  const observedValues = ["", expected];

  assert.equal(
    observedValues.findIndex(actual => areEquivalentWindowsDialogPaths(expected, actual)),
    1
  );
  assert.match(source, /while \(\$inputWatch\.ElapsedMilliseconds -lt 5000\)/);
  assert.match(source, /Start-Sleep -Milliseconds 150/);
  assert.match(source, /if \(Test-FileInputValue[\s\S]*?\$inputVerified = \$true[\s\S]*?break/);
  assert.match(source, /if \(-not \$inputVerified\)[\s\S]*?K2B_FILE_INPUT_VALUE_NOT_VERIFIED/);
});

test("입력값 검증 timeout 시 열기 Invoke를 실행하지 않는다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const expected = "Z:\\reports\\company\\data.txt";
  const observedValues = ["", "Z:\\reports", "previous.txt"];
  const verificationFailure = source.indexOf("if (-not $inputVerified)");
  const openInvoke = source.indexOf("$invokePattern.Invoke()", verificationFailure);

  assert.equal(
    observedValues.some(actual => areEquivalentWindowsDialogPaths(expected, actual)),
    false
  );
  assert.notEqual(verificationFailure, -1);
  assert.notEqual(openInvoke, -1);
  assert.ok(verificationFailure < openInvoke);
  assert.match(source, /value verified=false expected=/);
  assert.match(source, /value verified=true actual=/);
  assert.match(source, /K2B_DIAG\|open invoked/);
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

test("파일 선택창 진단은 후보 목록을 창마다 한 번만 남기고 실제 선택 컨트롤을 구분한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /\$script:candidatesLogged = \$false/);
  assert.match(source, /if \(-not \$script:candidatesLogged\)/);
  assert.match(source, /'candidate-edit'/);
  assert.match(source, /'candidate-button'/);
  assert.match(source, /'selected-input'/);
  assert.match(source, /'set-value-target'/);
  assert.match(source, /'selected-open-button'/);
  assert.match(source, /'open-button-invoke-completed'/);
  assert.match(source, /ControlType = \$control\.Current\.ControlType\.ProgrammaticName/);
  assert.match(source, /Name = \$control\.Current\.Name/);
  assert.match(source, /AutomationId = \$control\.Current\.AutomationId/);
  assert.match(source, /ClassName = \$control\.Current\.ClassName/);
  assert.match(source, /IsEnabled = \$control\.Current\.IsEnabled/);
  assert.match(source, /SupportsValuePattern = \$supportsValuePattern/);
  assert.match(source, /FullPath=/);
  assert.match(source, /\[attempt \$\{context\.attempt\}\]/);
});

test("업체코드는 파일 선택과 첨부 판정 및 다음 대상 진행 로그까지 전달된다", () => {
  const serviceSource = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const workerSource = readFileSync("lib/automation/worker-daemon.ts", "utf8");

  assert.match(serviceSource, /\[K2B\]\[\$\{businessCode\}\] TXT 파일 선택 단계 시작/);
  assert.match(serviceSource, /TXT 첨부 성공 판정/);
  assert.match(serviceSource, /1차 TXT 첨부 실패, 재시도 실행/);
  assert.match(serviceSource, /2차 TXT 첨부 실패, 해당 업체 실패 처리/);
  assert.match(workerSource, /uploadReport\(target\.business_name,[\s\S]*?businessCode\)/);
  assert.match(workerSource, /대상 처리 종료, 다음 대상 진행: \$\{nextBusinessCode\}/);
  assert.doesNotMatch(serviceSource + workerSource, /businessCode\s*===/);
});

test("다중업체 진단은 상태 초기화와 단계별 실패 및 배치 최종 결과를 구분한다", () => {
  const serviceSource = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const workerSource = readFileSync("lib/automation/worker-daemon.ts", "utf8");

  assert.match(serviceSource, /STATE_BEFORE previousBusinessCode=/);
  assert.match(serviceSource, /retryState=idle attemptCounter=0/);
  assert.match(serviceSource, /partialAttachmentRows=/);
  assert.match(serviceSource, /OpenDialogCount/);
  assert.match(serviceSource, /RESULT=FAILED stage=\$\{stage\}/);
  assert.match(serviceSource, /existing-upload handling ENTER/);
  assert.match(workerSource, /FINAL=\$\{result\.success \? 'SUCCESS' : 'FAILED'\}/);
  assert.match(workerSource, /failureStage: uploadRes\.failureStage/);
});
