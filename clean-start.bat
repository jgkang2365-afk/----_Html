@echo off
echo 🛑 Force stopping Node.js processes...
taskkill /F /IM node.exe >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Node.js process was not running or could not be stopped.
) else (
    echo Node.js process stopped.
)
set ERRORLEVEL=0

echo 🧹 Cleaning caches...
if exist .next (
    rmdir /s /q .next
    echo    - .next deleted
)
if exist node_modules\.cache (
    rmdir /s /q node_modules\.cache
    echo    - node_modules/.cache deleted
)

echo ✨ Done. Starting development server...
echo ----------------------------------------
npm run dev
