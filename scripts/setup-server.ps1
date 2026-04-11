# 측정일지 시스템 - 배포 서버(Windows 10) 초기 설정 스크립트
# 이 스크립트는 '빈 깡통' 상태의 새 컴퓨터에서 실행하여 시스템 구동에 필요한 기본 환경을 점검하고 설정을 돕습니다.

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "   측정일지 관리 시스템 - 서버 초기 설정 도구   " -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

# 1. 크롬 브라우저 설치 확인
$chromePath = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
$chromePath86 = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"

if ((Test-Path $chromePath) -or (Test-Path $chromePath86)) {
    Write-Host "[OK] 크롬 브라우저가 설치되어 있습니다." -ForegroundColor Green
} else {
    Write-Host "[ERROR] 크롬 브라우저를 찾을 수 없습니다. 설치 후 다시 실행해주세요." -ForegroundColor Red
    Write-Host "참고: K2B 자동화를 위해 크롬 브라우저가 반드시 필요합니다."
}

# 2. 필수 환경 변수 확인 및 생성 보조
function Set-EnvVariable {
    param($Name, $DefaultValue, $Description)
    $CurrentValue = [Environment]::GetEnvironmentVariable($Name, "User")
    if ($null -eq $CurrentValue) {
        $NewValue = Read-Host "$Description (기본값: $DefaultValue)"
        if ($NewValue -eq "") { $NewValue = $DefaultValue }
        [Environment]::SetEnvironmentVariable($Name, $NewValue, "User")
        Write-Host "[SET] $Name 설정 완료: $NewValue" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] $Name 가 이미 설정되어 있습니다: $CurrentValue" -ForegroundColor Gray
    }
}

Write-Host "`n--- 환경 변수(Environment Variables) 점검 ---"
Set-EnvVariable "K2B_HEADLESS" "true" "K2B 자동화 시 브라우저를 숨길까요? (true/false)"
Set-EnvVariable "REPORT_STORAGE_ROOT" "Z:\data\측정팀\측정보고서" "보고서 파일이 위치한 루트 경로를 입력하세요"
Set-EnvVariable "NAVER_EMAIL_ID" "example@naver.com" "발송용 네이버 이메일 ID"
Set-EnvVariable "NAVER_EMAIL_PW" "your_password" "발송용 네이버 앱 비밀번호"

# 3. 네트워크 드라이브 접근 확인
$storageRoot = [Environment]::GetEnvironmentVariable("REPORT_STORAGE_ROOT", "User")
if (Test-Path $storageRoot) {
    Write-Host "`n[OK] 저장소 경로($storageRoot)에 접근 가능합니다." -ForegroundColor Green
} else {
    Write-Host "`n[WARNING] 저장소 경로($storageRoot)를 찾을 수 없습니다." -ForegroundColor Yellow
    Write-Host "사유: Z: 드라이브 매핑이 안 되어 있거나, 네트워크 권한 문제입니다."
    Write-Host "해결: [네트워크 드라이브 연결] 또는 환경 변수에 실제 UNC 경로(예: \\\\Server\data)를 입력하세요."
}

Write-Host "`n==============================================="
Write-Host "설정이 완료되었습니다. 서버를 재부팅하거나" 
Write-Host "터미널을 다시 열어 설정을 적용하세요."
Write-Host "===============================================" -ForegroundColor Cyan
