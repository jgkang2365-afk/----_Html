[CmdletBinding()]
param()

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (-not $env:LOCALAPPDATA) {
    throw 'LOCALAPPDATA를 확인할 수 없습니다.'
}
$installDirectory = Join-Path $env:LOCALAPPDATA 'MeasurementJournal\ReportExplorerHelper'

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
$runtimeFiles = @(
    'report_explorer_helper.py',
    'run-report-explorer-helper.bat',
    'run-report-explorer-helper.vbs'
)
foreach ($runtimeFile in $runtimeFiles) {
    $source = Join-Path $PSScriptRoot $runtimeFile
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "설치 파일을 찾을 수 없습니다: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $installDirectory $runtimeFile) -Force
}

$builtExecutable = Join-Path $PSScriptRoot 'dist\ReportExplorerHelper.exe'
if (Test-Path -LiteralPath $builtExecutable -PathType Leaf) {
    Copy-Item -LiteralPath $builtExecutable -Destination (Join-Path $installDirectory 'ReportExplorerHelper.exe') -Force
}

$vbsPath = Join-Path $installDirectory 'run-report-explorer-helper.vbs'

$command = "wscript.exe //B //Nologo `"$vbsPath`""
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name 'MeasurementJournalReportExplorerHelper' -Value $command -PropertyType String -Force | Out-Null
Write-Output "사용자 영역에 설치하고 현재 사용자(HKCU) 자동 시작을 등록했습니다: $installDirectory"
