@echo off
:: 측정일지 로컬 서버 구동 배치 스크립트

:: 1. 프로젝트 폴더로 이동 (스크립트 위치 기준)
cd /d "%~dp0"

:: 2. Next.js 개발 서버 실행 (기본 3000 포트, Turbopack 활성화)
npm run dev:turbo

