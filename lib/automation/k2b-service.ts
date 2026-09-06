import { Builder, By, error, Key, until, WebDriver, WebElement } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import { resolveWindowsDialogPath } from './windows-file-path';

export async function runWithSingleRetry<T>(
    operation: (attempt: 1 | 2) => Promise<T>,
    onRetry: (error: unknown) => Promise<void> = async () => undefined
): Promise<T> {
    try {
        return await operation(1);
    } catch (error) {
        await onRetry(error);
        return operation(2);
    }
}

export function areEquivalentWindowsDialogPaths(expected: string, actual: string): boolean {
    const normalize = (value: string) => {
        const unquoted = value.trim().replace(/^"(.*)"$/, '$1');
        return path.win32.normalize(unquoted.replaceAll('/', '\\')).toLowerCase();
    };

    return actual.trim().length > 0 && normalize(expected) === normalize(actual);
}

const LOGIN_POPUP_SELECTORS = [
    'div#mainframe_VFrameSet_LoginFrame_form_div_popup_361_btn_close',
    'div#mainframe_VFrameSet_LoginFrame_form_div_popup_360_btn_close'
];

export async function closeExistingK2BLoginPopups(
    driver: Pick<WebDriver, 'findElements'>
): Promise<number> {
    let closedCount = 0;

    for (const selector of LOGIN_POPUP_SELECTORS) {
        const buttons = await driver.findElements(By.css(selector));
        if (buttons.length === 0) continue;

        await buttons[0].click();
        closedCount++;
    }

    return closedCount;
}

export async function closeInitialK2BLoginPopups(
    driver: Pick<WebDriver, 'findElements' | 'wait'>,
    timeoutMs = 2000
): Promise<number> {
    try {
        await driver.wait(async () => {
            for (const selector of LOGIN_POPUP_SELECTORS) {
                const buttons = await driver.findElements(By.css(selector));
                if (buttons.length > 0) return true;
            }
            return false;
        }, timeoutMs, undefined, 100);
    } catch (waitError) {
        if (!(waitError instanceof error.TimeoutError)) throw waitError;
    }

    return closeExistingK2BLoginPopups(driver);
}

type FileDialogDiagnosticContext = {
    businessCode: string;
    phase: 'TXT' | 'DRAWINGS';
    attempt: number;
};

type PowerShellExecFile = (
    file: string,
    args: string[],
    options: {
        windowsHide: boolean;
        stdio: ['ignore', 'pipe', 'pipe'];
        timeout?: number;
    }
) => Buffer | string;

export function executePowerShellScriptFile(
    command: string,
    timeoutMs?: number,
    execute: PowerShellExecFile = execFileSync as PowerShellExecFile
): string {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'k2b-powershell-'));
    const scriptPath = path.join(tempDirectory, 'file-dialog.ps1');

    try {
        // Windows PowerShell 5.1에서 한글과 특수문자를 안정적으로 읽도록 UTF-16LE BOM으로 기록합니다.
        fs.writeFileSync(scriptPath, `\uFEFF${command}`, 'utf16le');
        const output = execute(
            'powershell.exe',
            ['-NoProfile', '-Sta', '-NonInteractive', '-File', scriptPath],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs }
        );
        return Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
    } finally {
        try {
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        } catch {
            // 임시 파일 정리 실패가 K2B 본 작업 결과를 덮어쓰지 않게 합니다.
        }
    }
}

type K2BFailureStage =
    | 'file-dialog-ready'
    | 'file-input-ready'
    | 'file-open'
    | 'attachment-confirm'
    | 'existing-upload handling';

type K2BUploadResult = {
    success: boolean;
    status: string;
    message?: string;
    error?: string;
    failureStage?: K2BFailureStage;
};

/**
 * K2B 시스템 자동화 서비스
 * 파이썬 스크립트(작업환경측정결과 보고서 처리.py)의 connect_to_k2b 로직을 1:1 이식
 * 
 * 핵심 포인트:
 * - Nexacro 기반 K2B 사이트는 일반 input[type=file]이 아닌 OS 파일 대화상자를 사용
 * - 파이썬의 pyperclip + pyautogui 로직을 PowerShell SendKeys로 대체
 * - 로그인 요소는 고정 대기 대신 준비 조건을 우선 사용
 */
export class K2BService {
    private driver: WebDriver | null = null;
    private readOnlyMode = false;

    /**
     * 크롬 드라이버 초기화
     * 파이썬: options.add_argument("--start-maximized")
     *         options.add_experimental_option("detach", True)
     */
    async init(initOptions: { headless?: boolean; readOnly?: boolean } = {}) {
        this.readOnlyMode = initOptions.readOnly === true;
        // Next.js 환경에서 selenium-manager.exe 경로 설정
        const managerPath = process.env.SE_MANAGER_PATH || path.resolve(process.cwd(), 'node_modules', 'selenium-webdriver', 'bin', 'windows', 'selenium-manager.exe');
        if (fs.existsSync(managerPath)) {
            process.env.SE_MANAGER_PATH = managerPath;
            console.log(`[K2B] Selenium Manager Path: ${managerPath}`);
        }

        const chromeOptions = new chrome.Options();
        
        // 서버 구동 환경 대응: 화면 크기 및 headless 설정
        const isHeadless = initOptions.headless === true || process.env.K2B_HEADLESS?.toLowerCase().trim() === 'true';
        if (isHeadless) {
            console.log('[K2B] 헤드리스 모드(Headless)로 브라우저를 구동합니다.');
            chromeOptions.addArguments('--headless=new');
        } else {
            chromeOptions.addArguments('--start-maximized');
        }

        chromeOptions.addArguments('--no-sandbox');
        chromeOptions.addArguments('--disable-dev-shm-usage');
        chromeOptions.addArguments('--disable-gpu'); // 서버 환경에서 그래픽 가속 비활성화
        
        // detach 옵션: 스크립트 종료 후에도 브라우저 유지 (헤드리스가 아닐 때만 유의미)
        chromeOptions.excludeSwitches('enable-automation');

        console.log('[K2B] 크롬 드라이버 빌드를 시작합니다...');
        this.driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(chromeOptions)
            .build();

        if (!isHeadless) {
            // 한번 더 최대화 호출 (안전장치)
            await this.driver.manage().window().maximize();
        }
        console.log('[K2B] 크롬 드라이버 초기화 완료.');
    }

    /**
     * K2B 로그인 및 파일전송(신) 메뉴 진입
     * 
     * 로그인 흐름:
     * 1. k2b_url 접속
     * 2. 초기 비동기 로그인 팝업을 최대 2초 탐색 후 현재 존재하는 팝업 닫기
     * 3. ID/PW/로그인 버튼이 준비되는 즉시 입력 및 클릭
     * 4. 로그인 성공 화면 대기
     * 5. 내부 팝업 닫기 후 '파일전송(신)' 진입
     */
    async login(id?: string, pw?: string) {
        if (!this.driver) throw new Error('Driver not initialized');

        // Step 0: K2B 접속
        console.log('[K2B] 사이트 접속 중: https://k2b.kosha.or.kr/index.do');
        await this.driver.get('https://k2b.kosha.or.kr/index.do');

        // Step 1: 두 팝업을 합산 최대 2초 동안 polling하고 현재 DOM에 존재하는 팝업만 닫기
        await closeInitialK2BLoginPopups(this.driver);

        // Step 2: 로그인 정보 입력
        const loginId = id || process.env.K2B_ID;
        const loginPw = pw || process.env.K2B_PW;

        if (!loginId || !loginPw) {
            throw new Error('K2B ID 또는 PW가 제공되지 않았습니다.');
        }

        // ID 입력 (WebDriverWait 20초)
        const idInput = await this.driver.wait(
            until.elementLocated(By.css('#mainframe_VFrameSet_LoginFrame_form_div_Login_div_box_edt_mber_ID_input')),
            20000
        );
        await idInput.sendKeys(loginId);

        // PW 입력 (WebDriverWait 20초)
        const pwInput = await this.driver.wait(
            until.elementLocated(By.xpath("//*[@id='mainframe_VFrameSet_LoginFrame_form_div_Login_div_box_edt_password_input']")),
            20000
        );
        await pwInput.click();
        await pwInput.sendKeys(loginPw);

        // 로그인 버튼 클릭 (WebDriverWait 20초)
        const loginBtn = await this.driver.wait(
            until.elementLocated(By.css('#mainframe_VFrameSet_LoginFrame_form_div_Login_div_box_btn_loginTextBoxElement > div')),
            20000
        );
        console.log(`[K2B] 로그인 시도 중... (ID: ${loginId})`);
        await loginBtn.click();

        // 로그인 성공 확인 (성공 시 '파일전송(신)' 메뉴가 나타나고, 실패 시 로그인 실패 팝업이 나타남)
        let success = false;
        let loginErrorMessage = '';
        const maxAttempts = 20; // 최대 10초 대기 (500ms * 20)

        for (let i = 0; i < maxAttempts; i++) {
            // 1. 로그인 실패 팝업 감지
            try {
                const errorElements = await this.driver.findElements(By.css('div[id*="_form_tea_message"]'));
                if (errorElements.length > 0) {
                    const errorText = await errorElements[0].getText();
                    if (errorText.trim()) {
                        loginErrorMessage = errorText.trim();
                        // 팝업의 확인 버튼을 눌러 닫기 시도
                        const confirmBtns = await this.driver.findElements(By.css('div[id*="_form_btn_confirm"]'));
                        if (confirmBtns.length > 0) {
                            await confirmBtns[0].click();
                        }
                        break;
                    }
                }
            } catch (e) {
                // 에러 무시
            }

            // 2. 로그인 성공 감지 ('파일전송(신)' 메뉴 노출 여부)
            try {
                const fileTransferBtn = await this.driver.findElements(By.xpath("//div[text()='파일전송(신)']"));
                if (fileTransferBtn.length > 0) {
                    success = true;
                    break;
                }
            } catch (e) {
                // 에러 무시
            }

            await this.driver.sleep(500);
        }

        if (loginErrorMessage) {
            throw new Error(`로그인 실패: ${loginErrorMessage}`);
        }

        if (!success) {
            throw new Error('K2B 로그인 대기 시간 초과 또는 성공 화면으로의 전환이 실패했습니다.');
        }

        // 내부 화면 팝업 닫기 (메인 진입 후 뜨는 공지 등 팝업이 있다면 처리)
        try {
            const innerPopupBtn = await this.driver.wait(
                until.elementLocated(By.css('div#mainframe_VFrameSet_MainFrame_form_div_popup_363_btn_closeTextBoxElement > div')),
                3000
            );
            await innerPopupBtn.click();
            await this.driver.sleep(1000);
        } catch (e) {
            // 팝업이 없으면 무시
        }

        // '파일전송(신)' 버튼 클릭
        console.log("[K2B] 로그인 성공. '파일전송(신)' 메뉴로 이동합니다.");
        const fileTransferBtn = await this.driver.wait(
            until.elementLocated(By.xpath("//div[text()='파일전송(신)']")),
            5000
        );
        await fileTransferBtn.click();
        await this.driver.sleep(3000); // time.sleep(3)
    }

    /**
     * Windows 파일 선택창에서 사용할 경로를 준비합니다.
     * 관리자 권한 프로세스에서 매핑 드라이브가 보이지 않을 수 있으므로 UNC 경로를 우선합니다.
     */
    private resolveDialogPath(filePath: string): string {
        const resolvedPath = resolveWindowsDialogPath(filePath, {
            storageRoot: process.env.REPORT_STORAGE_ROOT,
            uncRoot: process.env.REPORT_STORAGE_UNC_ROOT
        });
        if (resolvedPath !== filePath) {
            console.log('[K2B] 파일 선택창에 UNC 경로를 사용합니다.');
        }
        return resolvedPath;
    }

    private logFileDialogDiagnostics(output: string, context?: FileDialogDiagnosticContext) {
        if (!context || !output) return;
        for (const rawLine of output.replace(/^\uFEFF/, '').replace(/\0/g, '').split(/\r?\n/)) {
            const line = rawLine.trimStart();
            if (!line.startsWith('K2B_DIAG|')) continue;
            console.log(
                `[K2B][${context.businessCode}][attempt ${context.attempt}][${context.phase}] ${line.substring('K2B_DIAG|'.length)}`
            );
        }
    }

    private runPowerShellScript(
        command: string,
        diagnosticContext?: FileDialogDiagnosticContext,
        timeoutMs?: number
    ) {
        try {
            const output = executePowerShellScriptFile(command, timeoutMs);
            this.logFileDialogDiagnostics(output, diagnosticContext);
            return output;
        } catch (error: any) {
            const stdout = Buffer.isBuffer(error?.stdout)
                ? error.stdout.toString('utf8')
                : String(error?.stdout || '');
            const stderr = Buffer.isBuffer(error?.stderr)
                ? error.stderr.toString('utf8')
                : String(error?.stderr || '');
            this.logFileDialogDiagnostics(stdout, diagnosticContext);
            if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') {
                throw new Error('Windows 파일 선택 입력 자동화가 제한시간 안에 종료되지 않았습니다.');
            }
            if (stderr.includes('K2B_CLIPBOARD_BUSY')) {
                throw new Error('Windows 클립보드가 사용 중이어서 파일 경로를 입력하지 못했습니다.');
            }
            if (stderr.includes('K2B_FILE_DIALOG_NOT_FOUND')) {
                throw new Error('K2B 파일 선택창을 활성화하지 못했습니다.');
            }
            if (stderr.includes('K2B_FILE_INPUT_NOT_READY')) {
                throw new Error('K2B 파일 선택창의 파일명 입력 컨트롤이 준비되지 않았습니다.');
            }
            if (stderr.includes('K2B_FILE_INPUT_VALUE_NOT_VERIFIED')) {
                throw new Error('K2B 파일 선택창의 파일명 입력값이 정상 반영되지 않았습니다.');
            }
            if (stderr.includes('K2B_FILE_OPEN_NOT_READY')) {
                throw new Error('K2B 파일 선택창의 열기 버튼이 준비되지 않았습니다.');
            }
            if (stderr.includes('K2B_FILE_OPEN_TIMEOUT')) {
                throw new Error('파일 열기 실행 후 K2B 파일 선택창이 닫히지 않았습니다.');
            }
            if (stderr.includes('K2B_FILE_DIALOG_PATH_REJECTED')) {
                throw new Error('파일 선택창에서 Z 드라이브 또는 UNC 경로를 열지 못했습니다.');
            }
            const stderrDetail = stderr.trim().slice(0, 4000);
            if (stderrDetail) {
                console.error(
                    `[K2B][${diagnosticContext?.businessCode || 'unknown'}] ` +
                    `Windows 파일 선택 자동화 stderr: ${stderrDetail}`
                );
            }
            throw new Error(
                `Windows 파일 선택 자동화 명령이 실패했습니다.` +
                (stderrDetail ? ` PowerShell 오류: ${stderrDetail}` : '')
            );
        }
    }

    /**
     * Windows 10 공통 파일 선택창의 파일명 입력 컨트롤이 실제 사용 가능한 상태가 될 때까지
     * UI Automation으로 확인한 뒤 경로를 직접 입력하고 '열기'를 실행합니다.
     */
    private sendFilesViaDialog(filePaths: string[], diagnosticContext: FileDialogDiagnosticContext) {
        const dialogPaths = filePaths.map(filePath => this.resolveDialogPath(filePath));
        const pathsBase64 = Buffer.from(JSON.stringify(dialogPaths), 'utf8').toString('base64');
        const command = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Write-ControlDiagnostic([string]$eventName, $control, [string]$extra = '') {
    $diagnosticValuePattern = $null
    $supportsValuePattern = $control.TryGetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern,
        [ref]$diagnosticValuePattern
    )
    $payload = [ordered]@{
        Event = $eventName
        ControlType = $control.Current.ControlType.ProgrammaticName
        Name = $control.Current.Name
        AutomationId = $control.Current.AutomationId
        ClassName = $control.Current.ClassName
        IsEnabled = $control.Current.IsEnabled
        SupportsValuePattern = $supportsValuePattern
    }
    if ($extra) { $payload.Extra = $extra }
    [Console]::Out.WriteLine('K2B_DIAG|' + ($payload | ConvertTo-Json -Compress))
}

function Normalize-SingleFilePath([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return '' }
    $normalized = $value.Trim().Trim([char]34).Replace('/', '\')
    try { $normalized = [IO.Path]::GetFullPath($normalized) } catch { }
    return $normalized.TrimEnd('\')
}

function Test-FileInputValue([string]$actualValue, $expectedPaths, [string]$expectedSelection) {
    if ([string]::IsNullOrWhiteSpace($actualValue)) { return $false }
    if (@($expectedPaths).Count -eq 1) {
        $expected = Normalize-SingleFilePath ([string]@($expectedPaths)[0])
        $actual = Normalize-SingleFilePath $actualValue
        return [string]::Equals($expected, $actual, [StringComparison]::OrdinalIgnoreCase)
    }
    $expected = $expectedSelection.Trim().Replace('/', '\')
    $actual = $actualValue.Trim().Replace('/', '\')
    return [string]::Equals($expected, $actual, [StringComparison]::OrdinalIgnoreCase)
}

function Get-ReadyFileDialog {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $windows = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $dialogFound = $false
    foreach ($window in $windows) {
        if ($window.Current.ClassName -ne '#32770' -or $window.Current.Name -notin @('열기', 'Open')) {
            continue
        }
        $dialogFound = $true
        $edits = $window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Edit
            ))
        )
        $buttons = $window.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Button
            ))
        )
        if (-not $script:candidatesLogged) {
            Write-ControlDiagnostic 'dialog' $window
            foreach ($edit in $edits) { Write-ControlDiagnostic 'candidate-edit' $edit }
            foreach ($button in $buttons) { Write-ControlDiagnostic 'candidate-button' $button }
            $script:candidatesLogged = $true
        }
        $fileInput = $null
        foreach ($edit in $edits) {
            if ($edit.Current.IsEnabled -and -not $edit.Current.IsOffscreen -and $edit.Current.AutomationId -eq '1148') {
                $fileInput = $edit
                break
            }
        }
        if (-not $fileInput) {
            foreach ($edit in $edits) {
                if ($edit.Current.IsEnabled -and -not $edit.Current.IsOffscreen -and
                    $edit.Current.Name -in @('파일 이름:', '파일 이름', 'File name:', 'File name')) {
                    $candidatePattern = $null
                    if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$candidatePattern)) {
                        $fileInput = $edit
                        break
                    }
                }
            }
        }
        if ($fileInput) {
            return [PSCustomObject]@{ DialogFound = $true; Dialog = $window; FileInput = $fileInput }
        }
    }
    return [PSCustomObject]@{ DialogFound = $dialogFound; Dialog = $null; FileInput = $null }
}

$pathsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathsBase64}'))
$paths = ConvertFrom-Json $pathsJson
if ($paths -is [string]) { $paths = @($paths) }
$selection = ($paths | ForEach-Object { '"' + $_ + '"' }) -join ' '
$script:candidatesLogged = $false
$watch = [Diagnostics.Stopwatch]::StartNew()
$ready = $null
$sawDialog = $false
while ($watch.ElapsedMilliseconds -lt 5000) {
    $state = Get-ReadyFileDialog
    $sawDialog = $sawDialog -or $state.DialogFound
    if ($state.FileInput) {
        $ready = $state
        break
    }
    Start-Sleep -Milliseconds 150
}
if (-not $ready) {
    if ($sawDialog) { throw 'K2B_FILE_INPUT_NOT_READY' }
    throw 'K2B_FILE_DIALOG_NOT_FOUND'
}
Write-Output ('K2B_DIAG|ready-ms=' + $watch.ElapsedMilliseconds)
Write-ControlDiagnostic 'selected-input' $ready.FileInput ('FullPath=' + $selection)
Write-Output 'K2B_DIAG|file input control ready'

$inputWatch = [Diagnostics.Stopwatch]::StartNew()
$inputVerified = $false
$setValueLogged = $false
$lastActualValue = ''
while ($inputWatch.ElapsedMilliseconds -lt 5000) {
    $inputState = Get-ReadyFileDialog
    if (-not $inputState.FileInput) {
        Start-Sleep -Milliseconds 150
        continue
    }

    $valuePattern = $null
    if (-not $inputState.FileInput.TryGetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern,
        [ref]$valuePattern
    )) {
        Start-Sleep -Milliseconds 150
        continue
    }

    try {
        if (-not $setValueLogged) {
            Write-ControlDiagnostic 'set-value-target' $inputState.FileInput ('FullPath=' + $selection)
            Write-Output 'K2B_DIAG|SetValue requested'
            $setValueLogged = $true
        }
        $valuePattern.SetValue($selection)
    } catch {
        Start-Sleep -Milliseconds 150
        continue
    }

    Start-Sleep -Milliseconds 150
    try { $lastActualValue = $valuePattern.Current.Value } catch { $lastActualValue = '' }
    if (Test-FileInputValue $lastActualValue $paths $selection) {
        $ready = $inputState
        $inputVerified = $true
        break
    }
}

if (-not $inputVerified) {
    Write-Output ('K2B_DIAG|value verified=false expected=' + $selection + ' actual=' + $lastActualValue)
    throw 'K2B_FILE_INPUT_VALUE_NOT_VERIFIED'
}
Write-Output ('K2B_DIAG|value verified=true actual=' + $lastActualValue)

$buttons = $ready.Dialog.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
    ))
)
$openButton = $null
foreach ($button in $buttons) {
    if ($button.Current.AutomationId -eq '1' -and $button.Current.IsEnabled -and -not $button.Current.IsOffscreen) {
        $openButton = $button
        break
    }
}
if (-not $openButton -or -not $openButton.Current.IsEnabled) {
    throw 'K2B_FILE_OPEN_NOT_READY'
}
Write-ControlDiagnostic 'selected-open-button' $openButton
$invokePattern = $null
if (-not $openButton.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
    throw 'K2B_FILE_OPEN_NOT_READY'
}
$invokePattern.Invoke()
Write-ControlDiagnostic 'open-button-invoke-completed' $openButton
Write-Output 'K2B_DIAG|open invoked'

$closeWatch = [Diagnostics.Stopwatch]::StartNew()
while ($closeWatch.ElapsedMilliseconds -lt 10000) {
    $state = Get-ReadyFileDialog
    if (-not $state.DialogFound) {
        Write-Output 'K2B_DIAG|dialog-closed'
        exit 0
    }
    Start-Sleep -Milliseconds 150
}
throw 'K2B_FILE_OPEN_TIMEOUT'
`;
        return this.runPowerShellScript(command, diagnosticContext, 25000);
    }

    private closeOpenFileDialog() {
        const command = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($window in $windows) {
    if ($window.Current.ClassName -eq '#32770' -and $window.Current.Name -in @('열기', 'Open')) {
        $windowPattern = $null
        if ($window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$windowPattern)) {
            $windowPattern.Close()
        }
    }
}
`;
        try {
            this.runPowerShellScript(command);
        } catch (error) {
            console.warn('[K2B] 실패한 파일 선택창 정리 오류:', (error as Error).message);
        }
    }

    async logBusinessBoundaryState(
        businessCode: string,
        previousBusinessCode: string | null,
        previousFilePath: string | null,
        currentFilePath: string | null
    ) {
        if (!this.driver) return;
        const command = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$dialogs = @()
foreach ($window in $windows) {
    if ($window.Current.ClassName -ne '#32770' -or $window.Current.Name -notin @('열기', 'Open')) { continue }
    $editValues = @()
    $edits = $window.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        ))
    )
    foreach ($edit in $edits) {
        $valuePattern = $null
        $value = $null
        if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
            $value = $valuePattern.Current.Value
        }
        $editValues += [ordered]@{
            Name = $edit.Current.Name
            AutomationId = $edit.Current.AutomationId
            ClassName = $edit.Current.ClassName
            Value = $value
        }
    }
    $dialogs += [ordered]@{
        Name = $window.Current.Name
        ClassName = $window.Current.ClassName
        EditValues = $editValues
    }
}
[Console]::Out.WriteLine('K2B_STATE|' + ([ordered]@{
    OpenDialogCount = $dialogs.Count
    Dialogs = $dialogs
} | ConvertTo-Json -Compress -Depth 5))
`;
        let dialogState = 'K2B_STATE|{"OpenDialogCount":"unknown"}';
        try {
            const output = this.runPowerShellScript(command);
            dialogState = output.split(/\r?\n/).find(line => line.startsWith('K2B_STATE|')) || dialogState;
        } catch (error) {
            dialogState = `K2B_STATE|{"SnapshotError":${JSON.stringify((error as Error).message)}}`;
        }

        const attachedRows = await this.driver.findElements(
            By.css('[id*="div_fileUp_grid_upload_body_gridrow_"][id*="cell_0_2"]')
        );
        const partialAttachmentRows = await Promise.all(
            attachedRows.map(element => element.isDisplayed().catch(() => false))
        ).then(results => results.filter(Boolean).length);
        console.log(
            `[K2B][${businessCode}] STATE_BEFORE previousBusinessCode=${previousBusinessCode || 'none'} ` +
            `previousFilePath=${previousFilePath || 'none'} currentFilePath=${currentFilePath || 'none'} ` +
            `retryState=idle attemptCounter=0 partialAttachmentRows=${partialAttachmentRows} ` +
            dialogState.substring('K2B_STATE|'.length)
        );
    }

    private classifyFileDialogFailure(error: unknown): K2BFailureStage {
        const message = error instanceof Error ? error.message : String(error);
        if (/열기 버튼|열기 실행|닫히지 않았/.test(message)) return 'file-open';
        if (/입력 컨트롤|입력값|입력 자동화|클립보드|실제 경로|경로를 열지 못/.test(message)) return 'file-input-ready';
        return 'file-dialog-ready';
    }

    /**
     * Windows 10 파일 선택창에서 폴더로 이동한 뒤 파일명을 입력합니다.
     */
    private sendFilePathViaDialog(filePath: string, diagnosticContext: FileDialogDiagnosticContext) {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            throw new Error(`TXT 파일이 실제 경로에 없습니다: ${filePath}`);
        }

        return this.sendFilesViaDialog([filePath], diagnosticContext);
    }
    /**
     * Windows 10 파일 선택창에서 도면 폴더로 이동한 뒤 여러 파일을 선택합니다.
     */
    private sendMultipleFilesViaDialog(
        drawingFolder: string,
        jpgFiles: string[],
        diagnosticContext: FileDialogDiagnosticContext
    ) {
        if (!fs.existsSync(drawingFolder) || !fs.statSync(drawingFolder).isDirectory()) {
            throw new Error(`도면 폴더가 실제 경로에 없습니다: ${drawingFolder}`);
        }
        const missingFile = jpgFiles.find(
            filename => !fs.existsSync(path.join(drawingFolder, filename))
        );
        if (missingFile) {
            throw new Error(`도면 파일이 실제 경로에 없습니다: ${missingFile}`);
        }

        return this.sendFilesViaDialog(
            jpgFiles.map(filename => path.join(drawingFolder, filename)),
            diagnosticContext
        );
    }
    /**
     * 단일 업체 보고서 업로드 실행
     * 
     * 파이썬 원본 흐름 (각 업체별):
     * 1. 팝업 확인 → 닫기 시도
     * 2. target_folder 존재 확인 및 txt 파일 탐색
     * 3. 'XML 추가' 클릭 → sleep(1) → pyperclip/pyautogui로 파일 선택 → sleep(3)
     * 4. '위치도 업로드' 클릭 → sleep(3) → 도면 폴더 확인
     *    - 도면 폴더 존재 & JPG 있음 → pyautogui로 다중 파일 선택 → sleep(3)
     *      → '적용' 클릭 → sleep(2) → 'XML 업로드' 클릭 → sleep(3)
     *      → 확인 팝업 클릭 → sleep(3) → 동일 파일/업로드 완료 분기 처리
     *    - 도면 폴더 없음 or JPG 없음 → XML 삭제 → 다음 업체
     */
    async uploadReport(
        companyName: string,
        files: {
            dataFile: { path: string; filename: string } | null;
            drawings: { path: string; filename: string }[];
            drawingFolderPath?: string;
        },
        businessCode: string = companyName
    ): Promise<K2BUploadResult> {
        if (this.readOnlyMode) throw new Error('K2B 읽기 전용 세션에서는 업로드할 수 없습니다.');
        if (!this.driver) throw new Error('Driver not initialized');
        if (!files.dataFile) {
            return { success: false, status: 'txt 파일 없음', error: 'TXT 데이터 파일이 없습니다.', failureStage: 'file-input-ready' };
        }
        if (!fs.existsSync(files.dataFile.path) || !fs.statSync(files.dataFile.path).isFile()) {
            return { success: false, status: 'TXT 경로 오류', error: `TXT 파일 경로를 찾을 수 없습니다: ${files.dataFile.path}`, failureStage: 'file-input-ready' };
        }

        try {
            console.log(`[K2B][${businessCode}] 업체 파일 선택 처리 시작: ${companyName}`);

            // 각 업체 처리 전 팝업 닫기 시도
            try {
                const popupBtn = await this.driver.wait(
                    until.elementLocated(By.css('div.popup_close_button')), 3000
                );
                await popupBtn.click();
            } catch (e) {
                // 팝업 없으면 무시 (except TimeoutException: pass)
            }

            // ===== Step 1~3: XML 추가 → 파일 선택창 준비/입력 → K2B 첨부 반영 확인 =====
            const locationButtonLocators = [
                By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_grid_upload_body_gridrow_0_cell_0_2gridCellContainerElement'),
                By.css('[id*="div_fileUp_grid_upload_body_gridrow_0_cell_0_2"]'),
                By.xpath('//*[contains(@id, "grid_upload") and contains(@id, "gridrow_0") and contains(@id, "cell_0_2")]')
            ];

            try {
                await runWithSingleRetry(async attempt => {
                    console.log(`[K2B][${businessCode}] TXT 파일 선택 단계 시작 (시도 ${attempt}/2)`);
                    try {
                    try {
                        const addXmlBtn = await this.driver!.wait(
                            until.elementLocated(By.xpath('//*[@id="mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_btn_AddTextBoxElement"]/div')),
                            20000
                        );
                        await addXmlBtn.click();
                        console.log(`[K2B][${businessCode}] XML 추가 클릭`);
                    } catch (error) {
                        throw new Error(`file-dialog-ready: XML 추가 버튼 처리 실패: ${error instanceof Error ? error.message : String(error)}`);
                    }

                    let dialogResult = '';
                    const diagnosticContext: FileDialogDiagnosticContext = {
                        businessCode,
                        phase: 'TXT',
                        attempt
                    };
                    try {
                        dialogResult = this.sendFilePathViaDialog(files.dataFile!.path, diagnosticContext);
                    } catch (error) {
                        const stage = this.classifyFileDialogFailure(error);
                        throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    const readyMs = /K2B_DIAG\|ready-ms=(\d+)/.exec(dialogResult)?.[1] || 'unknown';
                    console.log(`[K2B][${businessCode}] 파일 선택창 준비: ${readyMs}ms`);
                    console.log(`[K2B][${businessCode}] 전체 경로 입력 및 열기 Invoke 완료`);

                    let locationMapBtn: WebElement | null = null;
                    const attachmentDeadline = Date.now() + 10000;
                    while (!locationMapBtn && Date.now() < attachmentDeadline) {
                        for (const locator of locationButtonLocators) {
                            const elements = await this.driver!.findElements(locator);
                            for (const element of elements) {
                                if (await element.isDisplayed().catch(() => false)) {
                                    locationMapBtn = element;
                                    break;
                                }
                            }
                            if (locationMapBtn) break;
                        }
                        if (!locationMapBtn) await this.driver!.sleep(150);
                    }
                    if (!locationMapBtn) {
                        throw new Error('attachment-confirm: TXT 업로드 행 또는 위치도 버튼이 생성되지 않았습니다.');
                    }
                    console.log(`[K2B][${businessCode}] TXT 첨부 성공 판정: 위치도 버튼 표시됨`);
                    await locationMapBtn.click();
                    console.log(`[K2B][${businessCode}][attempt ${attempt}] RESULT=SUCCESS stage=attachment-confirm`);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        const stage = /^(file-dialog-ready|file-input-ready|file-open|attachment-confirm):/.exec(message)?.[1]
                            || 'attachment-confirm';
                        console.log(`[K2B][${businessCode}][attempt ${attempt}] RESULT=FAILED stage=${stage} error=${message}`);
                        throw error;
                    }
                }, async error => {
                    console.log(`[K2B][${businessCode}] 1차 TXT 첨부 실패, 재시도 실행: ${(error as Error).message}`);
                    this.closeOpenFileDialog();

                    const attachedRows = await this.driver!.findElements(locationButtonLocators[1]);
                    const hasAttachedRow = await Promise.all(
                        attachedRows.map(element => element.isDisplayed().catch(() => false))
                    ).then(results => results.some(Boolean));
                    if (hasAttachedRow) {
                        await this.deleteXml();
                    }
                });
            } catch (e) {
                console.log(`[K2B][${businessCode}] 2차 TXT 첨부 실패, 해당 업체 실패 처리: ${e instanceof Error ? e.message : String(e)}`);
                try {
                    const logDir = path.resolve(process.cwd(), 'logs');
                    fs.mkdirSync(logDir, { recursive: true });
                    const screenshot = await this.driver.takeScreenshot();
                    const screenshotPath = path.join(logDir, `k2b-location-error-${Date.now()}.png`);
                    fs.writeFileSync(screenshotPath, screenshot, 'base64');
                    console.error(`[K2B] 위치도 단계 오류 화면 저장: ${screenshotPath}`);
                } catch (screenshotError) {
                    console.error('[K2B] 오류 화면 저장 실패:', screenshotError);
                }
                return {
                    success: false,
                    status: 'TXT 첨부 오류',
                    error: `2회 시도 후 TXT 첨부에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`,
                    failureStage: (/^(file-dialog-ready|file-input-ready|file-open|attachment-confirm):/.exec(e instanceof Error ? e.message : String(e))?.[1]
                        || 'attachment-confirm') as K2BFailureStage
                };
            }

            // ===== Step 4: 도면 폴더 확인 및 JPG 업로드 =====
            const drawingFolderPath = files.drawingFolderPath || '';
            const hasDrawingFolder = drawingFolderPath && fs.existsSync(drawingFolderPath);

            if (hasDrawingFolder) {
                const validExtensions = ['.jpg', '.jpeg', '.png'];
                const jpgFiles = files.drawings
                    .map(d => d.filename)
                    .filter(f => validExtensions.some(ext => f.toLowerCase().endsWith(ext)))
                    .sort(); // 파이썬: jpg_files.sort()

                if (jpgFiles.length > 0) {
                    console.log(`[K2B] ${companyName}: JPG 파일 ${jpgFiles.length}개 발견`);

                    // 다중 파일 선택 (pyautogui 로직 대체)
                    try {
                        this.sendMultipleFilesViaDialog(drawingFolderPath, jpgFiles, {
                            businessCode,
                            phase: 'DRAWINGS',
                            attempt: 1
                        });
                    } catch (error) {
                        return {
                            success: false,
                            status: '도면 파일 선택 오류',
                            error: `K2B 파일 선택창에서 도면 파일을 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
                            failureStage: this.classifyFileDialogFailure(error)
                        };
                    }
                    console.log(`[K2B] ${companyName}: 파일명 입력 완료`);

                    // '적용' 버튼 클릭
                    try {
                        const applyBtn = await this.driver.wait(
                            until.elementLocated(By.xpath('//*[@id="mainframe_VFrameSet_MainFrame_DHW00211P01_form_div_Btn_btn_Save"]/div[2]')),
                            20000
                        );
                        await this.driver.wait(until.elementIsVisible(applyBtn), 20000);
                        await this.driver.wait(until.elementIsEnabled(applyBtn), 20000);
                        await applyBtn.click();
                    } catch (e) {
                        return { success: false, status: '적용 버튼 오류', error: '적용 버튼을 찾을 수 없습니다.', failureStage: 'attachment-confirm' };
                    }

                    // 'XML 업로드' 버튼 클릭
                    try {
                        const uploadBtn = await this.driver.wait(
                            until.elementLocated(By.xpath('//*[@id="mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_btn_UploadTextBoxElement"]/div')),
                            20000
                        );
                        await this.driver.wait(until.elementIsVisible(uploadBtn), 20000);
                        await this.driver.wait(until.elementIsEnabled(uploadBtn), 20000);
                        await uploadBtn.click();
                    } catch (e) {
                        return { success: false, status: 'XML 업로드 오류', error: 'XML 업로드 버튼을 찾을 수 없습니다.', failureStage: 'attachment-confirm' };
                    }

                    // XML 등록 확인 팝업 클릭
                    try {
                        const confirmBtn = await this.driver.wait(
                            until.elementLocated(By.xpath('//div[contains(@id, "btn_confirmTextBoxElement")]/div')),
                            20000
                        );
                        await confirmBtn.click();
                    } catch (e) {
                        return { success: false, status: '확인 팝업 오류', error: '업로드 확인 팝업을 찾을 수 없습니다.', failureStage: 'attachment-confirm' };
                    }

                    // ===== Step 5: 동일 파일 / 업로드 완료 분기 처리 =====
                    return await this.handleUploadResult(companyName, businessCode);

                } else {
                    // JPG 파일이 없는 경우 → XML 삭제 진행
                    console.log(`[K2B] ${companyName}: JPG 파일 없음`);
                    await this.deleteXml();
                    return { success: false, status: 'JPG 파일 없음', failureStage: 'attachment-confirm' };
                }
            } else {
                // 도면 폴더가 없는 경우 → XML 삭제 진행
                console.log(`[K2B] ${companyName}: 도면 폴더 없음`);
                await this.deleteXml();
                return { success: false, status: '도면 폴더 없음', failureStage: 'attachment-confirm' };
            }

        } catch (error: any) {
            console.error(`[K2B Error] ${companyName}:`, error.message);
            return { success: false, status: '자동화 오류', error: error.message, failureStage: 'attachment-confirm' };
        }
    }

    /**
     * XML 등록 확인 팝업 후 분기 처리
     * 
     * 파이썬 원본:
     * 1. '동일한' 텍스트 포함 메시지 확인 (5초) → 확인 → XML 삭제 → "동일 파일 삭제 완료"
     * 2. '업로드' 텍스트 포함 메시지 확인 (5초) → 확인 → "업로드 완료"
     * 3. 둘 다 없으면 → "예상된 메시지 없음"
     */
    private async handleUploadResult(companyName: string, businessCode: string): Promise<K2BUploadResult> {
        if (!this.driver) throw new Error('Driver not initialized');
        console.log(`[K2B][${businessCode}] existing-upload handling ENTER`);

        // Case 1: '동일한' 메시지 확인
        try {
            const duplicateMsg = await this.driver.wait(
                until.elementLocated(By.xpath("//*[contains(@id, '동일한 파일이 존재합니다') and contains(@id, 'form_tea_message_textarea')]")),
                5000
            );
            const msgText = await duplicateMsg.getText();
            console.log(`[K2B][${businessCode}] existing-upload handling DUPLICATE=true message=${msgText}`);

            // 확인 버튼 클릭
            const confirmBtn = await this.driver.wait(
                until.elementLocated(By.xpath('//div[text()="확인"]')), 10000
            );
            await confirmBtn.click();
            await this.driver.sleep(2000); // time.sleep(2)

            // XML 삭제
            await this.deleteXml();
            return { success: false, status: '동일 파일 삭제 완료', failureStage: 'existing-upload handling' };

        } catch (e) {
            // Case 2: '업로드' 메시지 확인
            try {
                const uploadMsg = await this.driver.wait(
                    until.elementLocated(By.xpath("//*[contains(text(), '업로드')]")),
                    5000
                );
                const msgText = await uploadMsg.getText();
                console.log(`[K2B][${businessCode}] existing-upload handling DUPLICATE=false message=${msgText}`);

                // '정상 접수처리 안내' 팝업 확인
                const successBtn = await this.driver.wait(
                    until.elementLocated(By.xpath('//div[text()="확인"]')), 10000
                );
                await successBtn.click();
                await this.driver.sleep(2000); // time.sleep(2)

                return { success: true, status: '업로드 완료' };

            } catch (e2) {
                console.log(`[K2B][${businessCode}] existing-upload handling RESULT=FAILED expected-message-not-found`);
                return { success: false, status: '예상된 메시지 없음', failureStage: 'existing-upload handling' };
            }
        }
    }

    /**
     * XML 삭제 프로세스
     * 
     * 파이썬 원본:
     * 1. XML 삭제 버튼 클릭 → time.sleep(2)
     * 2. 삭제 확인 팝업의 확인 버튼 클릭 → time.sleep(2)
     */
    private async deleteXml() {
        if (!this.driver) return;

        try {
            // XML 삭제 버튼 클릭
            const deleteBtn = await this.driver.wait(
                until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_fileUp_btn_DelTextBoxElement > div')),
                10000
            );
            await deleteBtn.click();
            await this.driver.sleep(2000); // time.sleep(2)

            // 삭제 확인 팝업의 확인 버튼 클릭
            const deleteConfirmBtn = await this.driver.wait(
                until.elementLocated(By.xpath('//div[text()="확인"]')),
                10000
            );
            await deleteConfirmBtn.click();
            await this.driver.sleep(2000); // time.sleep(2)
        } catch (e) {
            console.warn('[K2B] XML 삭제 중 오류:', (e as Error).message);
        }
    }

    /**
     * 파일 접수 현황 결과 추출
     * 
     * 파이썬 원본:
     * 1. time.sleep(10) → 데이터 처리 시간 확보
     * 2. 조회 버튼 클릭 → time.sleep(3)
     * 3. 그리드에서 사업장명(cell_X_1)과 처리상태(cell_X_2)를 반복 추출
     */
    async extractResults(): Promise<{ companyName: string; status: string }[]> {
        if (!this.driver) return [];

        const results: { companyName: string; status: string }[] = [];

        try {
            // 10초 대기 (데이터 처리 시간 확보)
            console.log('[K2B] 데이터 처리를 위해 10초 대기 후 조회합니다...');
            await this.driver.sleep(10000); // time.sleep(10)

            // 조회 버튼 클릭
            try {
                const searchBtn = await this.driver.wait(
                    until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_Search_btn_SearchTextBoxElement > div')),
                    10000
                );
                await searchBtn.click();
                console.log('[K2B] 접수 현황을 갱신했습니다.');
                await this.driver.sleep(3000); // time.sleep(3) - 조회 결과 로딩 대기
            } catch (e) {
                console.warn('[K2B] 조회 버튼 클릭 실패');
            }

            // 그리드에서 결과 추출
            try {
                await this.driver.wait(
                    until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_bodyGridBandContainerElement')),
                    10000
                );

                let rowIndex = 0;
                while (true) {
                    try {
                        // 사업장명 (cell_X_1)
                        const companySelector = `#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_body_gridrow_${rowIndex}_cell_${rowIndex}_1GridCellTextContainerElement > div`;
                        const companyEl = await this.driver.wait(
                            until.elementLocated(By.css(companySelector)), 2000
                        );

                        // 처리상태 (cell_X_2)
                        const statusSelector = `#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_body_gridrow_${rowIndex}_cell_${rowIndex}_2GridCellTextContainerElement > div`;
                        const statusEl = await this.driver.wait(
                            until.elementLocated(By.css(statusSelector)), 2000
                        );

                        const companyName = (await companyEl.getText()).trim();
                        const status = (await statusEl.getText()).trim();

                        if (companyName && companyName !== '알 수 없음') {
                            results.push({ companyName, status });
                            console.log(`[K2B] 사업장명: ${companyName} | 처리상태: ${status}`);
                        }

                        rowIndex++;
                    } catch (e) {
                        // 더 이상 행이 없으면 종료
                        break;
                    }
                }
            } catch (e) {
                console.warn('[K2B] 그리드 컨테이너를 찾을 수 없습니다.');
            }

        } catch (e) {
            console.error('[K2B] 결과 추출 실패:', (e as Error).message);
        }

        return results;
    }

    /** 검증 전용: 날짜 필터 설정 → 조회 → 현재 표시 그리드만 읽는 read-only 경로다. */
    async querySubmissionResultsForDate(resultDate: string): Promise<{ companyName: string; status: string; submissionDate: string }[]> {
        if (!this.driver) throw new Error('Driver not initialized');
        if (!this.readOnlyMode) throw new Error('K2B 날짜별 결과 조회는 읽기 전용 세션에서만 가능합니다.');
        const exactDate = resultDate.replaceAll('-', '');
        const startDateInput = await this.driver.wait(until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_Search_cal_fromdate_input')), 10000);
        const endDateInput = await this.driver.wait(until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_Search_cal_todate_input')), 10000);
        await startDateInput.clear();
        await startDateInput.sendKeys(exactDate);
        await endDateInput.clear();
        await endDateInput.sendKeys(exactDate);
        const searchButton = await this.driver.wait(until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_div_Search_btn_SearchTextBoxElement > div')), 10000);
        await searchButton.click();
        await this.driver.wait(until.elementLocated(By.css('#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_bodyGridBandContainerElement')), 10000);
        const rows: { companyName: string; status: string; submissionDate: string }[] = [];
        for (let rowIndex = 0; ; rowIndex++) {
            try {
                const company = await this.driver.wait(until.elementLocated(By.css(`#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_body_gridrow_${rowIndex}_cell_${rowIndex}_1GridCellTextContainerElement > div`)), 1500);
                const status = await this.driver.wait(until.elementLocated(By.css(`#mainframe_VFrameSet_MainFrame_form_div_Form_div_Work_103017203_div_Work_grid_fileList_body_gridrow_${rowIndex}_cell_${rowIndex}_2GridCellTextContainerElement > div`)), 1500);
                const companyName = (await company.getText()).trim();
                // 조회 범위를 같은 날짜로 고정했으므로, 행에 존재하는 실제 표시값만 읽는다.
                // K2B 화면에 없는 코드·사업자번호 등 식별자를 합성하지 않는다.
                if (companyName) rows.push({ companyName, status: (await status.getText()).trim(), submissionDate: resultDate });
            } catch { break; }
        }
        return rows;
    }

    /**
     * 브라우저 종료 (파이썬은 오류 시에만 종료, 정상 완료 시 유지)
     */
    async quit() {
        if (this.driver) {
            await this.driver.quit();
            this.driver = null;
        }
    }
}
