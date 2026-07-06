@echo off
:: 윈도우 시작프로그램 대신 작업 스케줄러(Task Scheduler)를 활용하여 백그라운드 구동 스크립트를 관리자 권한(최고 권한)으로 등록하는 배치 파일
chcp 65001 > nul

:: 1. 관리자 권한 확인
openfiles >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] 이 등록 스크립트는 반드시 '관리자 권한'으로 실행되어야 합니다.
    echo 배치 파일을 마우스 우클릭한 후 '관리자 권한으로 실행'을 선택해 주세요.
    echo.
    pause
    exit /b
)

set "StartupFolder=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SourceVBS=%~dp0run-server.vbs"

echo [안내] 기존 Startup 폴더에 등록된 일반 권한 바로가기가 있다면 제거합니다...
if exist "%StartupFolder%\RunMeasurementJournal.lnk" (
    del "%StartupFolder%\RunMeasurementJournal.lnk"
    echo [OK] 기존 일반 권한 바로가기 제거 완료.
)

echo.
echo [안내] 윈도우 작업 스케줄러에 최고 권한(관리자 권한) 백그라운드 실행 작업을 등록하고 있습니다...
echo (컴퓨터 로그인 시 비밀번호 입력창(UAC) 없이 자동으로 백그라운드에서 실행되게 조치합니다.)

:: schtasks를 사용하여 로그인 시 최고 권한(highest)으로 vbs를 구동하는 작업 생성
schtasks /create /tn "MeasurementJournalServer" /tr "\"%SourceVBS%\"" /sc onlogon /rl highest /f

if %errorlevel% equ 0 goto SUCCESS
goto FAILURE

:SUCCESS
echo.
echo ====================================================================
echo ✅ 등록이 성공적으로 완료되었습니다! [작업 스케줄러 등록 성공]
echo 컴퓨터가 켜지고 윈도우에 로그인하는 즉시 서버가 관리자 권한으로 백그라운드에서 자동 구동됩니다.
echo 검은색 창이 보이지 않더라도 백그라운드에서 localhost:3000이 계속 작동하게 되며,
echo MES 수동/자동 동기화 시 권한 부족 에러 및 UAC 팝업 대기가 발생하지 않습니다.
echo ====================================================================
goto END

:FAILURE
echo.
echo [오류] 작업 스케줄러 등록에 실패했습니다. 관리자 권한이 맞는지 확인해 주세요.
goto END

:END
echo.
pause
