@echo off
:: 윈도우 시작프로그램(Startup) 폴더에 백그라운드 구동 스크립트를 등록하는 배치 파일
chcp 65001 > nul

echo [안내] 기존에 등록된 작업 스케줄러(Task Scheduler) 항목이 있다면 제거를 시도합니다...
:: 기존 스케줄러 작업 삭제 시도 (있는 경우에만 제거)
schtasks /delete /tn "MeasurementJournalServer" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 기존 작업 스케줄러 항목 제거 완료.
) else (
    echo [안내] 삭제할 기존 작업 스케줄러 항목이 없거나 권한이 불충분합니다. (작업 없음 시 정상)
)

set "StartupFolder=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SourceVBS=%~dp0run-server.vbs"
set "ShortcutPath=%StartupFolder%\RunMeasurementJournal.lnk"

echo.
echo [안내] 윈도우 시작프로그램 폴더에 백그라운드 실행 바로가기를 생성하고 있습니다...
echo (컴퓨터 로그인 시 백그라운드에서 자동으로 서버가 구동됩니다.)
echo 대상 VBS: %SourceVBS%
echo 바로가기 경로: %ShortcutPath%

:: PowerShell을 사용하여 시작프로그램 폴더에 run-server.vbs를 가리키는 바로가기(.lnk) 생성
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%ShortcutPath%'); $Shortcut.TargetPath = '%SourceVBS%'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.Save()"

if %errorlevel% equ 0 goto SUCCESS
goto FAILURE

:SUCCESS
echo.
echo ====================================================================
echo ✅ 등록이 성공적으로 완료되었습니다! [시작프로그램 등록 성공]
echo 컴퓨터가 켜지고 윈도우에 로그인하면 서버가 일반 대화형 세션에서
echo 터미널 창 없이 백그라운드로 자동 구동됩니다.
echo.
echo 이제 Selenium(크롬 드라이버) 및 K2B 자동화 기능(SendKeys 포함)이
echo 로그인 환경과 동일하게 정상적으로 작동합니다.
echo ====================================================================
goto END

:FAILURE
echo.
echo [오류] 시작프로그램 바로가기 생성에 실패했습니다.
echo 폴더 권한이나 환경을 확인해 주세요.
goto END

:END
echo.
pause
