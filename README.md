# 측정일지 관리 시스템

작업환경측정 업무의 사업장, 예비조사, 측정일지, 측정대상, 문서 생성, 매출 및 관련 업무를 관리하는 웹 시스템입니다.

## 기술 스택

- Next.js 14
- TypeScript
- Tailwind CSS
- Supabase
- Vercel
- Windows 로컬 자동화 워커

## 개발 환경

의존성 설치:

    npm install

로컬 개발 서버:

    npm run dev:turbo

프로덕션 빌드 확인:

    npm run build

## 주요 디렉터리

    app/            Next.js 화면 및 API
    components/     UI 및 업무 기능 컴포넌트
    lib/            공통 로직, DB, 자동화 및 유틸리티
    scripts/        반복 사용되는 관리/운영 스크립트
    types/          TypeScript 타입
    docs/history/   과거 장애 및 해결 기록

## 프로젝트 문서

- `AGENTS.md` — AI 에이전트 작업 및 안전 원칙
- `project_rules.md` — 프로젝트 공통 기술·운영 정책
- `BUSINESS_LOGIC.md` — 업무 및 데이터 처리 규칙
- `docs/history/SUCCESS_DNA.md` — 과거 장애·원인·재발방지 기록

## 운영 구조

웹 애플리케이션과 Windows 로컬 자동화는 역할을 분리합니다.

- 웹/API 및 사용자 화면: Next.js / Vercel / Supabase
- 로컬 프로그램이 필요한 업무: Windows 워커 및 데몬
- MES, K2B, 문서 생성 등 외부 프로그램 의존 작업은 로컬 자동화 계층에서 처리합니다.

## 보안

- `.env.local` 및 인증정보를 Git에 커밋하지 않습니다.
- secret/service-role 키를 코드나 문서에 직접 기록하지 않습니다.
- 운영 DB 변경은 대상과 영향을 확인한 뒤 수행합니다.
