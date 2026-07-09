@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "MES_DAEMON_DRY_RUN=false"

where python >nul 2>&1
if %errorlevel% equ 0 (
    python mes_daemon.py
    goto END
)

where py >nul 2>&1
if %errorlevel% equ 0 (
    py -3 mes_daemon.py
    goto END
)

echo [오류] Python 실행 파일을 찾을 수 없습니다.
echo Python 설치 및 PATH 설정을 확인해 주세요.
pause

:END
