@echo off
:: 윈도우 시작프로그램(Startup)에 백그라운드 구동 스크립트 바로가기를 등록하는 배치 파일
chcp 65001 > null

set "StartupFolder=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SourceVBS=%~dp0run-server.vbs"

echo [안내] 윈도우 시작프로그램에 자동 실행 바로가기를 등록하고 있습니다...

:: PowerShell을 사용하여 시작프로그램 폴더에 바로가기(.lnk) 파일 생성
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%StartupFolder%\RunMeasurementJournal.lnk');$s.TargetPath='%SourceVBS%';$s.Save()"

echo.
echo ====================================================================
echo ✅ 등록이 성공적으로 완료되었습니다!
echo 컴퓨터가 켜지고 윈도우에 로그인하는 즉시 서버가 백그라운드로 자동 구동됩니다.
echo (검은색 창이 보이지 않더라도 백그라운드에서 localhost:3000이 계속 작동하게 됩니다.)
echo ====================================================================
echo.
pause
