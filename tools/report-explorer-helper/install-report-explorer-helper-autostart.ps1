[CmdletBinding()]
param()

$setupExecutable = Join-Path $PSScriptRoot 'dist\ReportExplorerSetup.exe'
if (-not (Test-Path -LiteralPath $setupExecutable -PathType Leaf)) {
    throw "빌드된 ReportExplorerSetup.exe를 찾을 수 없습니다: $setupExecutable"
}

& $setupExecutable
if ($LASTEXITCODE -ne 0) {
    throw "ReportExplorerSetup.exe가 실패했습니다: $LASTEXITCODE"
}
Write-Output 'ReportExplorerSetup.exe가 현재 사용자 설치와 Updater 자동 시작을 완료했습니다.'
