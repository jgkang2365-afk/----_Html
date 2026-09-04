@echo off
setlocal
set "HELPER_DIR=%~dp0"

if exist "%HELPER_DIR%dist\ReportExplorerHelper.exe" (
  "%HELPER_DIR%dist\ReportExplorerHelper.exe"
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  py -3 "%HELPER_DIR%report_explorer_helper.py"
  exit /b %ERRORLEVEL%
)

python "%HELPER_DIR%report_explorer_helper.py"
