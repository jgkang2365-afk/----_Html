# External Integrations - 측정일지 관리 시스템

본 시스템이 외부 서비스 및 데이터 원본과 상호작용하는 방식입니다.

## 1. K2B 고용노동부 전산망 (핵심 자동화)
- **목적**: 측정 결과 및 측정일지 성적서를 정부 전산망에 대량 자동 등록.
- **연동 방식**: `Selenium WebDriver`를 통한 브라우저 제어.
- **기술적 특이점**: 브라우저 보안 정책으로 직접 제어가 어려운 파일 업로드 창 등은 PowerShell `SendKeys`를 병행하여 처리.
- **관련 구현**: `lib/automation/k2b-service.ts`

## 2. Supabase (BaaS)
- **Database**: PostgreSQL 기반의 유연한 스키마 구조. (최신 변경: 멀티 데이트 지원을 위한 필드 확장)
- **Storage**: `excel-files`, `reports`, `backups` 버킷 관리.
- **Edge Functions**: 고비용 작업(엑셀 파싱 등)의 서버 사이드 오프로딩 지원.

## 3. Google Workspace
- **Google Calendar API**: 사업장별 측정 일정을 캘린더에 자동 기록하여 전 직원이 동기화된 일정을 공유하도록 지원.
- **Sync Logic**: `lib/google/sync-service.ts`

## 4. 로컬 네트워크 드라이브 (Z:)
- **운영 환경**: 대형 병원/연구소 내 폐쇄망 또는 공유 폴더에 위치한 엑셀 원본 파일을 직접 읽어오기 위한 경로 설정 지원.
- **연동 구현**: `lib/sync/excel-sync.ts`의 `Z:` 드라이브 우선 탐색 로직.
