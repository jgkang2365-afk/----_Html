[CmdletBinding()]
param()

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$vbsPath = Join-Path $PSScriptRoot 'run-report-explorer-helper.vbs'
if (-not (Test-Path -LiteralPath $vbsPath -PathType Leaf)) {
    throw "시작 스크립트를 찾을 수 없습니다: $vbsPath"
}

$command = "wscript.exe //B //Nologo `"$vbsPath`""
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name 'MeasurementJournalReportExplorerHelper' -Value $command -PropertyType String -Force | Out-Null
Write-Output '현재 사용자(HKCU) 자동 시작을 등록했습니다. 관리자 권한은 필요하지 않습니다.'
