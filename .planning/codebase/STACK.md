# Project Stack - 측정일지 관리 시스템

본 프로젝트에서 사용되는 주요 기술 스택과 라이브러리 정의서입니다.

## Core Framework
- **Next.js 14 (App Router)**: 서버 사이드 렌더링(SSR) 및 API Routes 처리를 위한 메인 프레임워크.
- **TypeScript**: 정적 타입 체킹을 통한 코드 안정성 확보.
- **Node.js**: 런타임 환경.

## UI & Styling
- **Tailwind CSS**: 유틸리티 우선 디자인 프레임워크.
- **Lucide React**: 아이콘 라이브러리.

## Backend & Database
- **Supabase (PostgreSQL)**: 메인 데이터베이스 및 실시간 데이터 처리.
- **Supabase Auth**: 사용자 인증 및 세션 관리.
- **Supabase Storage**: 엑셀 문서 및 리포트 파일 저장소.

## Automation & Processing
- **Selenium (Webdriver)**: K2B 사이트 접속 및 데이터 전송 자동화.
- **XLSX (SheetJS)**: 복잡한 엑셀 파일(`.xls`, `.xlsx`) 파싱 및 생성을 위한 핵심 엔진.
- **Google Knowledge / APIs**: 일정 및 데이터 동기화를 위한 연동 모듈.

## Development Tools
- **Vercel**: 프론트엔드 배포 및 호스팅.
- **PowerShell / Bash**: OS 레벨의 자동화 제어 (SendKeys 등).
