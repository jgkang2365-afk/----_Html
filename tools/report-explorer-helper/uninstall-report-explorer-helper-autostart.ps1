[CmdletBinding()]
param()

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $runKey -Name 'MeasurementJournalReportExplorerHelper' -ErrorAction SilentlyContinue
Write-Output '현재 사용자(HKCU) 자동 시작을 해제했습니다.'
