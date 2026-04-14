# Project Structure - 측정일지 관리 시스템

프로젝트의 최상위 구조 및 주요 디렉토리 구성입니다.

## 1. Directory Overview

```text
root/
├── app/                  # Next.js 14 App Router
│   ├── api/              # 백엔드 API 엔드포인트
│   ├── dashboard/        # 통계 및 현황 판넬
│   ├── (auth)/           # 인증(로그인, 가입) 샌드박스
│   └── journal/          # 측정일지 등록 및 검색 메인 UI
├── components/           # 재사용 가능한 React UI 컴포넌트
│   ├── features/         # 비즈니스 특화 기능 컴포넌트 (JournalEditForm 등)
│   └── shared/           # 공통 UI 요소 (Button, Input 등)
├── lib/                  # 비즈니스 로직 및 유틸리티
│   ├── sync/             # 엑셀 동기화 엔진 (excel-sync.ts)
│   ├── automation/       # K2B 자동화 서비스
│   ├── utils/            # 알고리즘, 날짜 계산기, 정규표현식 등
│   └── supabase/         # DB 클라이언트 설정
├── supabase/             # 마이그레션 파일 및 데이터베이스 스키마
├── public/               # 정적 애셋 (이미지, 폰트)
└── .planning/            # [GSD2] 프로젝트 관리 및 코드베이세 매핑 문서
```

## 2. Key Files & Features
- **`lib/sync/excel-sync.ts`**: 시스템의 심장부. 대규모 엑셀 파싱 및 'Latest Wins' 동기화 담당. 약 2,300 라인 규모.
- **`components/features/JournalEditForm.tsx`**: 복합적인 측정 정보를 입력받고 멀티 일수 자동 계산 로직 적용.
- **`lib/utils/date-utils.ts`**: 한국 공휴일Rule을 기반으로 한 영업일 계산 및 정규화 기능 제공.
- **`lib/utils/number-assignment.ts`**: 5인 이상 연번 부여 등 비즈니스 핵심 번호 정책 구현.

## 3. Data Specification (핵심 인터페이스 명세)

에이전트 수정 시 참조할 필수 데이터 명세입니다.

### 3-1. JournalEntry (측정일지 데이터)
- **필수 필드 (Required)**:
  - `id`: `number | null` (DB 저장 전에는 null)
  - `code`: `string` (사업장 코드)
  - `measurement_year`: `number`
  - `measurement_period`: `string`
  - `business_name`, `designated_office`, `address`: `string`
  - `completion_status`: `string` ('완료'/'미완료' 등)
  - `measurement_start_date`, `measurement_end_date`: `string | null`
  - `measurement_days`: `number | null` (**최근 추가된 필수 필드**)
  - `measurer`: `string | null`
  - `created_at`, `updated_at`: `string` (ISO8601)
- **선택 필드 (Optional)**:
  - `business_number`, `representative_name`, `phone`, `fax`, `manager_email` 등 연락처 정보
  - `industrial_accident_number`, `commencement_number` 등 행정 번호
  - `_isFromBusiness`: `boolean` (비즈니스 관리 연동 여부)
