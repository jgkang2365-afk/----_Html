---
description: DB 데이터 정합성 검사 및 정리 워크플로우
---

# DB 데이터 정합성 검사 및 해결 가이드

사용자가 DB가 꼬여있다고 느낄 때, 데이터를 직접 확인하고 정리할 수 있는 SQL 실행 워크플로우입니다.

## 1. 데이터 확인 (Supabase SQL Editor에서 실행)
먼저, 문제가 되는 사업장의 데이터가 실제로 어떻게 저장되어 있는지 확인합니다.
(아래 `H0130` 부분을 실제 문제가 되는 `code`로 변경해서 실행하세요)

```sql
-- 1. measurement_business (사업장 관리) 데이터 확인
-- 여기에 값이 있는데 API에서 안 나온다면, API 쿼리 조건 문제일 수 있습니다.
SELECT 
  id, code, year, period, business_name, 
  industrial_accident_number, invoice_email, manager_email
FROM measurement_business
WHERE code = 'H0130' 
ORDER BY year DESC, period DESC;

-- 2. measurement_journal (측정일지) 데이터 확인
-- 최근 일지에 빈 값이 있다면, 그게 우선순위로 덮어씌워졌을 수 있습니다.
SELECT 
  id, code, measurement_year, measurement_period, 
  industrial_accident_number, invoice_email, manager_email
FROM measurement_journal
WHERE code = 'H0130'
ORDER BY measurement_year DESC, measurement_period DESC;
```

## 2. 데이터 정리 및 동기화 (해결책)

데이터가 중복되거나, 비어있는 rows가 많다면 정리가 필요합니다.

### 2-1. 빈 데이터(Null) 일괄 정리
`measurement_business`에 의미 없는 빈 데이터가 생성되어 있다면 삭제하거나 정리합니다.

```sql
-- (주의) 실제로 데이터를 삭제하는 쿼리입니다. 백업 후 실행 권장.
-- 예: 사업장명도 없고 코드만 있는 쓰레기 데이터 삭제
DELETE FROM measurement_business
WHERE business_name IS NULL OR business_name = '';
```

### 2-2. 최신 데이터로 업데이트 (수동 보정)
만약 특정 연도의 데이터가 비어있다면, 가장 최신 데이터로 채워넣을 수 있습니다.

```sql
-- 예: 2026년 상반기 H0130 데이터의 산재번호가 비어있다면, 2025년 하반기 값으로 업데이트
UPDATE measurement_business
SET 
  industrial_accident_number = (
    SELECT industrial_accident_number 
    FROM measurement_business 
    WHERE code = 'H0130' AND year = 2025 AND period = '하반기'
  ),
  invoice_email = (
    SELECT invoice_email
    FROM measurement_business 
    WHERE code = 'H0130' AND year = 2025 AND period = '하반기'
  )
WHERE code = 'H0130' AND year = 2026 AND period = '상반기'
  AND (industrial_accident_number IS NULL OR industrial_accident_number = '');
```

## 3. (개발자용) API 로직 간소화 제안
DB 데이터 문제가 아니라 API가 너무 복잡하게 꼬여있다면, 아래와 같이 로직을 단순화할 것을 제안합니다.

1.  **복잡한 우선순위 제거**: 
    *   `journal` 테이블은 아예 조회하지 않고, **오직 `measurement_business` 테이블만** 참조하도록 변경.
    *   "과거 이력" 로직도 제거하고, **요청한 `year`, `period`에 데이터가 없으면 그냥 빈 값**으로 리턴.
    *   대신, 사용자가 "전년도 데이터 불러오기" 버튼을 누를 때만 별도로 과거 데이터를 조회하도록 UI/UX 변경.

2.  **`route.ts` 롤백**:
    *   최근 추가한 복잡한 `fallback` 로직들을 모두 제거하고, 단순한 `SELECT * FROM measurement_business` 로직으로 회귀.
