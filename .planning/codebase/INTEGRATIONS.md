# External Integrations - 측정일지 관리 시스템

본 시스템이 외부 서비스 및 타 시스템과 연동되는 방식에 대한 정의서입니다.

## 1. K2B 시스템 (핵심 연동)
- **목적**: 측정 데이터 전송 및 자동 등록.
- **방식**: `Selenium WebDriver`를 통한 웹 브라우저 제어.
- **특이사항**: OS 레벨의 `SendKeys` 명령(PowerShell)을 사용하여 파일 업로드 대화상자 등 브라우저가 직접 제어하지 못하는 윈도우 컨트롤을 처리함.
- **관련 파일**: `lib/automation/k2b-service.ts`

## 2. Supabase (Backend as a Service)
- **Database**: PostgreSQL 기반의 관계형 데이터 저장.
- **Auth**: Email/Password 기반의 사용자 인증.
- **Storage**: `excel-files`, `reports` 버킷을 통해 엑셀 원본 및 생성된 보고서 관리.

## 3. Google Workspace
- **Google Calendar**: 작업 일정 및 동기화된 일지 정보 기록.
- **Sync Service**: Google API를 통한 주기적인 데이터 동기화.
- **관련 파일**: `lib/google/calendar.ts`, `lib/google/sync-service.ts`

## 4. Local File System
- **연동**: 네트워크 드라이브(Z:) 또는 로컬 경로의 `사업장정보.xls`, `측정사업장.xls` 파일을 감시하고 동기화함.
- **방식**: `fs` 모듈과 `xlsx` 라이브러리를 사용한 스트림 파싱.
