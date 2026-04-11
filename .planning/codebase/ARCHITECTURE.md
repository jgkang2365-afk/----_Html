# Architecture & Data Flow - 측정일지 관리 시스템

본 시스템의 소프트웨어 아키텍처와 계층별 데이터 흐름을 정의합니다.

## 시스템 계층구조
1. **Frontend (UI Layer)**: Next.js App Router 기반 컴포넌트 (`app/` 디렉토리). 사용자와 상호작용하며 실시간 상태 관리 및 API 통신 담당.
2. **Logic Layer (Service Layer)**: `lib/` 디렉토리에 위치한 비즈니스 모듈.
   - `lib/sync/`: 엑셀 데이터 파싱 및 DB 동기화.
   - `lib/automation/`: Selenium 및 OS 제어를 통한 외부 시스템 연동.
   - `lib/utils/`: 데이터 형식화, 관할청 매칭, 일련번호 부여 알고리즘.
3. **Storage & Database (Data Layer)**: Supabase 기반의 데이터 영속화 계층.

## 데이터 파이프라인 (Data Pipeline)
1. **수집 (Ingestion)**: 사용자가 `.xls/xlsx` 파일을 업로드하거나 네트워크 드라이브(Z:) 파일 감시.
2. **처리 (Processing)**: `excel-sync.ts`에서 각 사업장의 코드(HXXXX)를 식별하고, 특정 로직(5인 이상 연번 등)에 따라 데이터를 가공.
3. **저장 (Persistence)**: 가공된 데이터를 `business_info`, `measurement_business`, `measurement_journal` 테이블에 업데이트.
4. **연동 (Automation)**: 저장된 데이터를 바탕으로 K2B 사이트에 로그인하여 필드를 자동 입력하고 전송 처리.

## 주요 설계 패턴
- **Service Object Pattern**: 복잡한 자동화 및 파싱 로직을 별도의 서비스 클래스(`K2BService`, `ExcelSync`)로 분리하여 유지보수성 확보.
- **Incremental Sync**: 전체 데이터를 덮어쓰지 않고, `code`와 `year/period`를 기반으로 변경 사항만 선별적으로 업데이트.
