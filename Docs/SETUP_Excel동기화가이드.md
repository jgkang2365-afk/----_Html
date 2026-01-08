# Excel 파일 동기화 설정 가이드

## 개요

이 가이드는 Excel 파일 동기화 서비스를 설정하고 사용하는 방법을 설명합니다.

## 파일 구조

- `lib/sync/excel-sync.ts`: Excel 파일 동기화 로직
- `app/api/sync/route.ts`: 수동 동기화 API 엔드포인트
- `app/api/cron/sync/route.ts`: 자동 동기화 Cron Job 엔드포인트
- `vercel.json`: Vercel Cron Jobs 설정

## Excel 파일 준비

Excel 파일은 프로젝트 루트 디렉토리에 배치해야 합니다:
- `사업장정보.xlsx` (또는 `사업장정보.xls`)
- `측정사업장.xlsx` (또는 `측정사업장.xls`)

**참고**: `.xlsx` 형식이 우선적으로 사용되며, `.xls` 형식도 지원합니다.

**중요**: Vercel 배포 환경에서는 파일 시스템 접근이 제한됩니다. 
- 로컬 개발 환경: 프로젝트 루트의 Excel 파일 사용
- 프로덕션 환경: 파일 업로드 기능 또는 외부 저장소(S3, Supabase Storage) 사용 필요

## Excel 파일 컬럼명 매핑

실제 Excel 파일의 컬럼명에 맞게 `lib/sync/excel-sync.ts`의 매핑 함수를 수정해야 합니다.

### 사업장정보.xlsx 매핑 (실제 컬럼명 확인 완료)

`parseBusinessInfo()` 함수에서 다음 실제 컬럼명을 매핑합니다:
- `code`: "코드"
- `business_name`: "사업장명"
- `business_number`: "사업자번호"
- `address1`: "주소1"
- `address2`: "주소2"
- `phone`: "전화번호"
- `fax`: "팩스번호"
- `representative_name`: "대표자명"

**총 컬럼 수**: 27개 (위 매핑은 주요 필드만 포함)

### 측정사업장.xlsx 매핑 (실제 컬럼명 확인 완료)

`parseMeasurementBusiness()` 함수에서 다음 실제 컬럼명을 매핑합니다:
- `code`: "코드" (마지막 컬럼)
- `year`: "년도"
- `period`: "구분" (상반기/하반기)
- `business_name`: "사업장명"
- `business_number`: "사업자번호"
- `total_employees`: "총인원"
- `address`: "주소"
- `office_jurisdiction`: "관할청명"
- `measurement_start_date`: "측정시작일"
- `measurement_end_date`: "측정종료일"
- `completion_status`: "완료여부" (완료/미완료)
- `measurer`: "측정자(담당)" 또는 "측정자" 또는 "담당"

**총 컬럼 수**: 103개 (위 매핑은 주요 필드만 포함)

**중요**: `measurement_business` 테이블은 `(code, year, period)` 조합이 유니크합니다. 같은 코드가 여러 년도와 주기에 걸쳐 존재할 수 있습니다.

## 사용 방법

### 1. 수동 동기화 (API 호출)

#### 모든 파일 동기화
```bash
POST /api/sync
```

#### 특정 파일만 동기화
```bash
POST /api/sync?type=business-info        # 사업장정보.xls만
POST /api/sync?type=measurement-business # 측정사업장.xls만
```

#### 동기화 로그 조회
```bash
GET /api/sync
```

### 2. 자동 동기화 (Cron Jobs)

Vercel Cron Jobs를 사용하여 일일 2회 자동 동기화 (오전 9시, 오후 6시)

#### 환경 변수 설정

`.env.local` 파일에 다음 변수를 추가:
```
CRON_SECRET=your-secret-key-here
```

#### Vercel 설정

`vercel.json` 파일에 Cron Jobs 설정이 포함되어 있습니다:
```json
{
  "crons": [
    {
      "path": "/api/cron/sync",
      "schedule": "0 9,18 * * *"
    }
  ]
}
```

Vercel 대시보드에서도 Cron Jobs를 설정할 수 있습니다.

### 3. 대시보드에서 동기화 상태 확인

대시보드 페이지(`/dashboard`)에서 다음을 확인할 수 있습니다:
- 각 Excel 파일의 마지막 동기화 시간
- 동기화 상태 (성공/실패/진행중)
- 처리된 레코드 수 (신규/업데이트)
- 최근 동기화 로그 (최대 5개)
- 수동 동기화 버튼

**컴포넌트**: `components/features/SyncStatus.tsx`

## 트러블슈팅

### Excel 파일 읽기 실패

**문제**: "Excel 파일 읽기 실패" 오류

**해결 방법**:
1. 파일 경로 확인: 프로젝트 루트에 Excel 파일이 있는지 확인
2. 파일 형식 확인: .xls 또는 .xlsx 형식인지 확인
3. 파일 권한 확인: 파일 읽기 권한이 있는지 확인

### 컬럼명 매핑 오류

**문제**: 데이터가 올바르게 파싱되지 않음

**해결 방법**:
1. Excel 파일의 실제 컬럼명 확인
2. `lib/sync/excel-sync.ts`의 매핑 함수 수정
3. 테스트 후 재동기화

### 데이터베이스 업데이트 실패

**문제**: "데이터 삽입/업데이트 실패" 오류

**해결 방법**:
1. 데이터베이스 연결 확인
2. 테이블 스키마 확인 (`lib/db/migrations/001_initial_schema.sql`)
3. 필수 필드 확인 (code, business_name 등)
4. 데이터 형식 확인 (날짜, 숫자 등)

### Vercel 배포 환경에서 파일 접근 불가

**문제**: 프로덕션 환경에서 Excel 파일을 찾을 수 없음

**해결 방법** (향후 구현):
1. 파일 업로드 API 구현
2. Supabase Storage 또는 AWS S3 사용
3. 외부 파일 서버 사용

## 참고 사항

- Excel 파일은 일일 2회 자동 업데이트됩니다 (오전 9시, 오후 6시) - Vercel Cron Jobs
- 수동 동기화는 대시보드에서 언제든지 가능합니다
- 동기화 로그는 `sync_log` 테이블에 기록됩니다
- 동기화 중 오류가 발생하면 로그에 기록됩니다
- `measurement_business` 테이블은 `(code, year, period)` 조합으로 UPSERT됩니다
- Excel 날짜 형식은 자동으로 변환됩니다 (Excel 숫자 형식 → YYYY-MM-DD)

## 테스트 방법

### 1. 컬럼명 확인
```bash
npx tsx scripts/check-excel-columns.ts
```

### 2. 수동 동기화 테스트
1. 개발 서버 실행: `npm run dev`
2. 브라우저에서 `/dashboard` 접속
3. "수동 동기화" 버튼 클릭
4. 동기화 상태 확인

### 3. API 직접 호출 테스트
```bash
# 모든 파일 동기화
curl -X POST http://localhost:3000/api/sync

# 사업장정보만 동기화
curl -X POST "http://localhost:3000/api/sync?type=business-info"

# 동기화 로그 조회
curl http://localhost:3000/api/sync
```

