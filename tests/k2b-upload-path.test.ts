import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  replaceWindowsPathRoot,
  resolveWindowsDialogPath,
} from "../lib/automation/windows-file-path";
import {
  areEquivalentWindowsDialogPaths,
  executePowerShellScriptFile,
  getPowerShellCommandLengths,
  getPowerShellSpawnErrorMetadata,
  logFileDialogBoundary,
  logFileDialogError,
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

test("UIA SetValue는 제한시간이 있는 백그라운드 STA 스레드로 실행한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /thread\.IsBackground = true/);
  assert.match(source, /thread\.SetApartmentState\(ApartmentState\.STA\)/);
  assert.match(source, /if \(!thread\.Join\(timeoutMs\)\)/);
  assert.match(source, /ValuePattern\.SetValue timeout/);
  assert.match(source, /input method=UIA input attempt timed out=true/);
});

test("Win32 입력은 SendMessageTimeout으로 보호하고 실제 값을 다시 읽는다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /WM_SETTEXT = 0x000C/);
  assert.match(source, /WM_GETTEXT = 0x000D/);
  assert.match(source, /SMTO_ABORTIFHUNG = 0x0002/);
  assert.match(source, /TrySetWin32/);
  assert.match(source, /TryGetWin32/);
  assert.match(source, /input method=WIN32 input attempt started/);
});

test("Win32 실패 시 timeout 보호된 UIA fallback을 사용한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const win32Input = source.indexOf("TrySetWin32(", source.indexOf("$inputApplied = $false"));
  const fallbackGuard = source.indexOf("if (-not $inputApplied)", win32Input);
  const uiaInput = source.indexOf("TrySetUia(", fallbackGuard);

  assert.ok(win32Input >= 0 && fallbackGuard > win32Input && uiaInput > fallbackGuard);
});

test("모든 입력 방식이 멈춰도 PowerShell 프로세스 최종 timeout이 Worker를 복귀시킨다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /timeout: timeoutMs/);
  assert.match(source, /error\?\.code === 'ETIMEDOUT'/);
  assert.match(source, /runPowerShellScript\(command, diagnosticContext, 25000\)/);
  assert.match(source, /Windows 파일 선택 입력 자동화가 제한시간 안에 종료되지 않았습니다/);
  assert.match(source, /입력 컨트롤\|입력값\|입력 자동화/);
  assert.match(source, /K2B_FILE_INPUT_VALUE_NOT_VERIFIED/);
});

test("PowerShell 명령과 기존 EncodedCommand 길이를 계산한다", () => {
  const lengths = getPowerShellCommandLengths("Write-Output '한글'");

  assert.equal(lengths.commandLength, "Write-Output '한글'".length);
  assert.ok(lengths.encodedCommandLength > lengths.commandLength);
});

test("PowerShell 본문은 UTF-16LE BOM 임시 ps1로 생성하고 -File로 실행한 뒤 삭제한다", () => {
  let scriptPath = "";
  let timeout: number | undefined;

  const output = executePowerShellScriptFile(
    "Write-Output '정상'",
    25000,
    (file, args, options) => {
      assert.equal(file, "powershell.exe");
      assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-Sta", "-NonInteractive", "-File"]);
      scriptPath = args[4];
      timeout = options.timeout;
      assert.equal(existsSync(scriptPath), true);
      const script = readFileSync(scriptPath);
      assert.deepEqual([...script.subarray(0, 2)], [0xff, 0xfe]);
      assert.match(script.toString("utf16le"), /Write-Output '정상'/);
      return Buffer.from("success");
    }
  );

  assert.equal(output, "success");
  assert.equal(timeout, 25000);
  assert.equal(existsSync(scriptPath), false);
  assert.equal(existsSync(dirname(scriptPath)), false);
});

test("PowerShell 실행 실패 시에도 임시 ps1을 삭제하고 spawn metadata를 보존한다", () => {
  let scriptPath = "";
  const spawnError = Object.assign(new Error("spawnSync powershell.exe ENAMETOOLONG"), {
    code: "ENAMETOOLONG",
    errno: -4064,
    syscall: "spawnSync powershell.exe",
    signal: null,
  });

  assert.throws(
    () => executePowerShellScriptFile("Write-Output '실패'", 25000, (_file, args) => {
      scriptPath = args[4];
      throw spawnError;
    }),
    error => error === spawnError
  );

  assert.equal(existsSync(scriptPath), false);
  assert.equal(existsSync(dirname(scriptPath)), false);
  assert.deepEqual(getPowerShellSpawnErrorMetadata(spawnError), {
    code: "ENAMETOOLONG",
    errno: -4064,
    syscall: "spawnSync powershell.exe",
    message: "spawnSync powershell.exe ENAMETOOLONG",
    signal: "none",
  });
});

test("PowerShell 실행은 EncodedCommand 대신 임시 ps1 -File 전달을 사용한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /'-File', scriptPath/);
  assert.doesNotMatch(source, /'-EncodedCommand'/);
  assert.match(source, /POWERSHELL_COMMAND_LENGTH=/);
  assert.match(source, /POWERSHELL_ENCODED_LENGTH=/);
  assert.match(source, /POWERSHELL_SPAWN_ERROR/);
});

test("bridge 초기화 경계와 PowerShell 컴파일 오류를 보존한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");
  const initStart = source.indexOf("K2B_DIAG|bridge init start");
  const addType = source.indexOf("Add-Type -AssemblyName UIAutomationClient", initStart);
  const initSuccess = source.indexOf("K2B_DIAG|bridge init success", addType);

  assert.ok(initStart >= 0 && addType > initStart && initSuccess > addType);
  assert.match(source, /stderr\.trim\(\)\.slice\(0, 4000\)/);
  assert.match(source, /Windows 파일 선택 자동화 stderr/);
  assert.match(source, /PowerShell 오류: \$\{stderrDetail\}/);
  assert.match(source, /replace\(\/\\0\/g, ''\)/);
});

test("파일 선택 호출 경계는 업체코드와 attempt를 stdout에 남긴다", () => {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));

  try {
    logFileDialogBoundary(
      { businessCode: "H0507", phase: "TXT", attempt: 1 },
      "sendFilesViaDialog ENTER"
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(messages, ["[K2B][H0507][attempt 1] sendFilesViaDialog ENTER"]);
});

test("파일 선택 예외는 줄바꿈 없이 FILE_DIALOG_ERROR로 stdout에 보존한다", () => {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));

  try {
    logFileDialogError(
      { businessCode: "H0502", phase: "TXT", attempt: 2 },
      new Error("PowerShell compile\nfailed")
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(messages, [
    "[K2B][H0502][attempt 2] FILE_DIALOG_ERROR=PowerShell compile failed",
  ]);
});

test("TXT 파일 선택 흐름은 경로 해석과 PowerShell 호출 전후 경계를 모두 기록한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /sendFilePathViaDialog ENTER path=/);
  assert.match(source, /sendFilesViaDialog ENTER/);
  assert.match(source, /resolveDialogPath BEFORE path=/);
  assert.match(source, /resolveDialogPath AFTER path=/);
  assert.match(source, /runEncodedPowerShell ENTER/);
  assert.match(source, /runEncodedPowerShell EXIT success/);
  assert.match(source, /catch \(error\) \{\s*logFileDialogError\(diagnosticContext, error\)/);
});

test("첨부 제어는 첫 실패만 정리 후 한 번 재시도한다", async () => {
  const attempts: number[] = [];
  let cleanupCount = 0;
  let retryError: unknown;

  const result = await runWithSingleRetry(
    async attempt => {
      attempts.push(attempt);
      if (attempt === 1) throw new Error("temporary");
      return "success";
    },
    async error => {
      cleanupCount++;
      retryError = error;
    }
  );

  assert.equal(result, "success");
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(cleanupCount, 1);
  assert.equal((retryError as Error).message, "temporary");
});

test("첨부 제어는 두 번째 실패 후 추가 재시도하지 않는다", async () => {
  let attemptCount = 0;
  const secondError = new Error("second attempt failed");

  await assert.rejects(
    runWithSingleRetry(async attempt => {
      attemptCount++;
      if (attempt === 1) throw new Error("first attempt failed");
      throw secondError;
    }),
    error => error === secondError
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
  assert.match(source, /'win32-input-target'/);
  assert.match(source, /'uia-input-target'/);
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
