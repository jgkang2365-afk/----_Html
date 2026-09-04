[CmdletBinding()]
param()

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $runKey -Name 'MeasurementJournalReportExplorerHelper' -ErrorAction SilentlyContinue
if ($env:LOCALAPPDATA) {
    $expectedDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MeasurementJournal\ReportExplorerHelper'))
    if (Test-Path -LiteralPath $expectedDirectory -PathType Container) {
        $resolvedDirectory = (Resolve-Path -LiteralPath $expectedDirectory).Path
        if (-not [string]::Equals($resolvedDirectory, $expectedDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "예상하지 않은 설치 경로이므로 제거하지 않습니다: $resolvedDirectory"
        }
        Remove-Item -LiteralPath $resolvedDirectory -Recurse -Force
    }
}
Write-Output '현재 사용자(HKCU) 자동 시작을 해제하고 사용자 영역의 헬퍼 파일을 제거했습니다.'
