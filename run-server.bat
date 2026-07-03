@echo off
:: 측정일지 로컬 서버 구동 배치 스크립트

:: 1. 프로젝트 폴더로 이동 (사용자 컴퓨터 경로에 맞춤)
cd /d "c:\Users\USER\Desktop\안티그래티비\측정일지_html"

:: 2. Next.js 개발 서버 실행 (기본 3000 포트)
npm run dev
