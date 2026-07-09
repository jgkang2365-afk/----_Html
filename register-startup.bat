@echo off
:: 웹 개발서버와 MES 데몬을 윈도우 로그인 시 자동 실행하도록 등록
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
set "MesTrayVbs=%~dp0run-mes-tray.vbs"
set "MesTaskName=MeasurementJournalMESDaemon"

echo.
echo [안내] 윈도우 시작프로그램 폴더에 백그라운드 실행 바로가기를 생성하고 있습니다...
echo (컴퓨터 로그인 시 백그라운드에서 자동으로 서버가 구동됩니다.)
echo 대상 VBS: %SourceVBS%
echo 바로가기 경로: %ShortcutPath%

:: PowerShell을 사용하여 시작프로그램 폴더에 run-server.vbs를 가리키는 바로가기(.lnk) 생성
powershell -NoProfile -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%ShortcutPath%'); $Shortcut.TargetPath = '%SourceVBS%'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.Save()"

if not %errorlevel% equ 0 goto FAILURE

echo.
echo [안내] MES 동기화 트레이 관리자를 최고 권한 작업으로 등록하고 있습니다...
schtasks /delete /tn "%MesTaskName%" /f >nul 2>&1
schtasks /create /tn "%MesTaskName%" /sc onlogon /ru "%USERDOMAIN%\%USERNAME%" /rl highest /it /tr "wscript.exe %MesTrayVbs%" /f

if not %errorlevel% equ 0 goto FAILURE
goto SUCCESS

:SUCCESS
echo.
echo ====================================================================
echo ✅ 등록이 성공적으로 완료되었습니다! [시작프로그램 등록 성공]
echo 컴퓨터가 켜지고 윈도우에 로그인하면 서버가 일반 대화형 세션에서
echo 터미널 창 없이 백그라운드로 자동 구동됩니다.
echo.
echo MES 동기화 데몬도 알림 영역 아이콘으로 자동 실행되어 요청을 대기합니다.
echo MES 화면 자동화가 필요하므로 윈도우 사용자 로그인은 반드시 필요합니다.
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
