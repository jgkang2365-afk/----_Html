@echo off
cd /d "%~dp0"
echo Starting Supabase Database Backup...
npm run backup
echo Backup Complete!
pause
