[CmdletBinding()]
param()

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (-not $env:LOCALAPPDATA) {
    throw 'LOCALAPPDATA를 확인할 수 없습니다.'
}
$installDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MeasurementJournal\ReportExplorerHelper'))
$builtExecutable = Join-Path $PSScriptRoot 'dist\ReportExplorerHelper.exe'
$destinationExecutable = Join-Path $installDirectory 'ReportExplorerHelper.exe'

if (-not (Test-Path -LiteralPath $builtExecutable -PathType Leaf)) {
    throw "빌드된 ReportExplorerHelper.exe를 찾을 수 없습니다: $builtExecutable. build-report-explorer-helper.ps1을 먼저 실행하세요."
}

function Get-RunningHelperProcessIds([string]$ExpectedExecutable, [string]$ExpectedDirectory) {
    $expectedScript = Join-Path $ExpectedDirectory 'report_explorer_helper.py'
    $matches = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $ExpectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($expectedScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    }
    return @($matches | ForEach-Object { $_.ProcessId })
}

$runningProcessIds = Get-RunningHelperProcessIds $destinationExecutable $installDirectory
if ($runningProcessIds.Count -gt 0) {
    throw "실행 중인 설치 대상 헬퍼(PID: $($runningProcessIds -join ', '))가 있어 교체하지 않습니다. 작업 관리자에서 해당 PID를 종료한 뒤 다시 실행하세요."
}

New-Item -ItemType Directory -Path $installDirectory -Force -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath $builtExecutable -Destination $destinationExecutable -Force -ErrorAction Stop

# 이전 Python 배포의 알려진 런타임 파일만 EXE 설치 완료 후 정리한다.
foreach ($legacyRuntimeFile in @('report_explorer_helper.py', 'run-report-explorer-helper.bat', 'run-report-explorer-helper.vbs')) {
    $legacyPath = Join-Path $installDirectory $legacyRuntimeFile
    if (Test-Path -LiteralPath $legacyPath -PathType Leaf) {
        Remove-Item -LiteralPath $legacyPath -Force -ErrorAction Stop
    }
}

$command = ('"{0}"' -f $destinationExecutable)
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name 'MeasurementJournalReportExplorerHelper' -Value $command -PropertyType String -Force | Out-Null
Write-Output "ReportExplorerHelper.exe를 사용자 영역에 설치하고 현재 사용자(HKCU) 자동 시작을 등록했습니다: $installDirectory"
