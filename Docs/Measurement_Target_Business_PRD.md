# 측정 대상 사업장 관리 시스템 PRD (Product Requirements Document)

## 1. 개요
본 문서는 '측정 대상 사업장 관리' 섹션의 재구축을 위한 요구사항을 정의합니다. 기존의 동적 조회 방식을 탈피하고, 독립적인 테이블(`measurement_target_business`)을 기반으로 데이터를 관리하며, 엑셀 업로드 시 타 테이블의 데이터를 연동하여 초기값을 구성하는 방식을 채택합니다.

## 2. 목표
- 1920x1080 해상도에서 가로 스크롤 없이 모든 정보를 한눈에 볼 수 있는 최적화된 UI 제공.
- 엑셀 업로드 시 기존 데이터(`measurement_journal`, `business_info`, `national_support_application`)를 지능적으로 연동하여 입력 편의성 증대.
- 데이터의 스냅샷 저장을 통해, 확정된 계획 데이터가 외부 요인(타 테이블 변경)에 의해 의도치 않게 변하는 것을 방지.

## 3. 데이터베이스 설계 (`measurement_target_business`)

기존 테이블을 삭제하고 아래 스키마로 재생성합니다.

| 필드명 | 타입 | 설명 | 비고 |
|---|---|---|---|
| id | Integer | PK | Auto Increment |
| year | Integer | 년도 | 복합 Unique Key (code, year, period) |
| period | String | 주기 | "상반기", "하반기" |
| code | String | 사업장 코드 | `business_info.code` 참조 |
| is_registered | String | 실시여부 | "실시", "미실시", "거래종료" |
| national_support_status | String | 국고결과 | |
| plan_manager | String | 계획담당자 | 한기문, 강종구, 이주형, NULL |
| previous_measurement_date | Date | 전회측정일 | |
| previous_measurement_period | String | 전회측정주기 | |
| future_measurement_date | Date | 금회예정일 | |
| measurement_month | String | 측정예정월 | "1월" ~ "12월" |
| measurement_date | Date | 금회측정확정일 | |
| business_category | String | 업종분류 | |
| address | String | 주소 | |
| office_jurisdiction | String | 소재지 관할청 | 약어로 저장/표시 |
| business_name | String | 사업장명 | |
| manager_name | String | 담당자명 | |
| manager_mobile | String | 담당자 휴대폰 | |
| phone | String | 회사전화번호 | |
| notes | String | 비고 | |
| updated_at | DateTime | 수정일시 | |

* **미수횟수**: DB 컬럼으로 저장하지 않고, 목록 조회 시 `measurement_journal` 테이블에서 실시간 집계하여 표시합니다. (요구사항 2항 "미수 자료를 제외한 사항은 연동하지 않아도 됨"에 근거)

## 4. 핵심 로직

### 4.1. 데이터 연동 (Data Sync)
- **발동 시점**: 엑셀 업로드 시 또는 신규 업체 추가 시.
- **연동 대상**: 
    - `business_info` (m.i)
    - `measurement_business` (m.b)
    - `measurement_journal` (m.j)
    - `national_support_application` (m.s.a)
- **우선순위 규칙**:
  - 데이터가 없는 경우(NULL), **최신 5개 주기**(예: 26상 -> 25하 -> 25상 -> 24하 -> 24상) 내의 데이터를 역순으로 탐색하여 가장 먼저 발견된 값을 사용합니다.
- **필드별 매핑 및 출처**:
    - **실시여부**: 기본값 "미실시" (거래종료인 경우 "거래종료")
    - **국고결과**: `m.s.a` (해당 년/주기)
    - **전회측정일/주기**: `m.j` (직전 주기 검색)
    - **측정예정월**: 전회측정일 + 주기 -> 계산된 월
    - **주소/사업장명/연락처**: `m.b` (최신) 또는 `m.i`
    - **업종분류**: 엑셀 업로드 값 우선 -> `business_info` 참고
    - **소재지 관할청**: `m.b` 기준

### 4.2. 엑셀 업로드
- **양식**: 시스템에서 제공하는 템플릿 사용.
- **헤더 매핑**: 1행에 `m.i_code`와 같은 약어 표기를 허용하여 매핑 정확도 향상.
- **동작**: 업로드 된 엑셀 데이터 + DB 연동 데이터 = 최종 데이터 저장.

## 5. UI/UX 요구사항
- **해상도**: 1920x1080 기준 가로 스크롤 없음.
- **레이아웃**:
  - **상단**: [측정년도] [측정주기] [지정지청] [사업장명 검색] [주소 검색] [실시여부] [검색] [업체추가] [엑셀업로드] (한 줄 배치)
  - **목록 우측 상단**: [계획담당자 목록상자] [엑셀다운로드]
- **테이블**:
  - 헤더 고정 (`sticky`).
  - 너비 최적화: `주소`, `사업장명`, `비고`는 줄바꿈 허용. 나머지는 최소 너비.
  - **실시여부 색상**: 실시(연녹색), 미실시(연노랑), 거래종료(연적색).

## 6. API 설계 (개요)
- `GET /api/measurement-target-businesses`: 목록 조회 (Paging 없음, 전체 조회).
- `POST /api/measurement-target-businesses`: 업체 추가.
- `PUT /api/measurement-target-businesses`: 정보 수정.
- `POST /api/measurement-target-businesses/upload`: 엑셀 업로드 및 처리.
