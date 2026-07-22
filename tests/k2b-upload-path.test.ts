import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  replaceWindowsPathRoot,
  resolveWindowsDialogPath,
} from "../lib/automation/windows-file-path";

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

test("K2B Windows 10 파일 선택은 주소창 경로 입력과 단계별 오류를 사용한다", () => {
  const source = readFileSync("lib/automation/k2b-service.ts", "utf8");

  assert.match(source, /resolveWindowsDialogPath/);
  assert.match(source, /path\.win32\.dirname\(dialogFilePath\)/);
  assert.match(source, /path\.win32\.basename\(dialogFilePath\)/);
  assert.match(source, /SendWait\('%[dl]'\)/);
  assert.match(source, /SendWait\('%n'\)/);
  assert.match(source, /REPORT_STORAGE_UNC_ROOT/);
  assert.match(source, /'-Sta'/);
  assert.match(source, /SetDataObject/);
  assert.doesNotMatch(source, /Clipboard\]::SetText/);
  assert.match(source, /K2B_CLIPBOARD_BUSY/);
  assert.match(source, /TXT 파일 선택 오류/);
  assert.match(source, /도면 파일 선택 오류/);
  assert.doesNotMatch(source, /execSync\(`powershell -command/);
});
