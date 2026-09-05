[CmdletBinding()]
param()

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (-not $env:LOCALAPPDATA) {
    throw 'LOCALAPPDATA를 확인할 수 없습니다.'
}

$expectedDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MeasurementJournal\ReportExplorerHelper'))
$expectedExecutable = Join-Path $expectedDirectory 'ReportExplorerHelper.exe'
$expectedCommand = ('"{0}"' -f $expectedExecutable)
$registeredCommand = (Get-ItemProperty -Path $runKey -Name 'MeasurementJournalReportExplorerHelper' -ErrorAction SilentlyContinue).'MeasurementJournalReportExplorerHelper'
if ($null -ne $registeredCommand -and -not [string]::Equals($registeredCommand, $expectedCommand, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "자동 시작 값이 예상한 EXE 경로와 달라 제거하지 않습니다: $registeredCommand"
}

$expectedLegacyScript = Join-Path $expectedDirectory 'report_explorer_helper.py'
$runningProcessIds = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $expectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine.IndexOf($expectedLegacyScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
} | ForEach-Object { $_.ProcessId })
if ($runningProcessIds.Count -gt 0) {
    throw "실행 중인 설치 대상 헬퍼(PID: $($runningProcessIds -join ', '))가 있어 제거하지 않습니다. 작업 관리자에서 해당 PID를 종료한 뒤 다시 실행하세요."
}

if ($null -ne $registeredCommand) {
    Remove-ItemProperty -Path $runKey -Name 'MeasurementJournalReportExplorerHelper' -ErrorAction Stop
}

if (Test-Path -LiteralPath $expectedDirectory -PathType Container) {
    $directoryItem = Get-Item -LiteralPath $expectedDirectory -Force
    if ($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "재분석 지점 설치 경로이므로 제거하지 않습니다: $expectedDirectory"
    }
    $resolvedDirectory = (Resolve-Path -LiteralPath $expectedDirectory).Path
    if (-not [string]::Equals($resolvedDirectory, $expectedDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "예상하지 않은 설치 경로이므로 제거하지 않습니다: $resolvedDirectory"
    }
    Remove-Item -LiteralPath $resolvedDirectory -Recurse -Force -ErrorAction Stop
}
Write-Output '현재 사용자(HKCU) EXE 자동 시작을 해제하고 사용자 영역의 헬퍼 파일을 제거했습니다.'
