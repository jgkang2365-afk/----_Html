# Project Stack - 측정일지 관리 시스템

본 프로젝트는 최신 웹 개발 스택과 업무 자동화를 위한 라이브러리들을 혼합하여 구현되었습니다.

## 1. Core Framework & Language
- **Next.js 14 (App Router)**: 서버 컴포넌트(SSR) 기반의 안정적인 대시보드 및 API 구축.
- **TypeScript**: 데이터 타입 안정성 확보 및 유지보수 편의성 증대.
- **Node.js**: 서버 사이드 런타임 환경.

## 2. Interface & Styling
- **Tailwind CSS**: 유틸리티 기반 프레임워크를 활용한 반응형 UI 구현.
- **Lucide React**: 현대적인 아이콘 세트.
- **Vanilla CSS (global)**: 디자인 일관성을 위한 전역 테마 관리.

## 3. Storage & Authentication
- **Supabase (PostgreSQL)**: 실시간 데이터베이스 및 복잡한 관계형 쿼리 처리.
- **Supabase Auth**: 이메일/비밀번호 기반의 사용자 인증 체계.
- **Supabase Storage**: 엑셀 원본 파일 및 성적서 PDF 저장.

## 4. Automation & Data Processing
- **Selenium WebDriver (Node.js)**: K2B 전산망 접속 및 자동 데이터 전송 엔진.
- **XLSX (SheetJS)**: 대용량 엑셀(`사업장정보`, `측정사업장`)의 고속 파싱 및 데이터 정제.
- **Google Sheets/Calendar API**: 외부 캘린더 연동 및 스케줄 관리.

## 5. Development Utilities
- **Vercel**: 프론트엔드 및 API 호스팅.
- **ts-node / npx**: 스크립트 기반 데이터 검증 및 일회성 작업 실행.
- **Custom Mapping Engine**: `.planning/codebase/` 문서를 통한 컨텍스트 유지 시스템.
