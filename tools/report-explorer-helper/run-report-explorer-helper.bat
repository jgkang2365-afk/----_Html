@echo off
setlocal
set "HELPER_DIR=%~dp0"

rem Source-tree launcher only: installed EXE starts in production policy by default.
if "%REPORT_EXPLORER_ENVIRONMENT%"=="" set "REPORT_EXPLORER_ENVIRONMENT=development"

if exist "%HELPER_DIR%ReportExplorerHelper.exe" (
  "%HELPER_DIR%ReportExplorerHelper.exe"
  exit /b %ERRORLEVEL%
)

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
