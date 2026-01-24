-- 아래 쿼리를 Supabase 대시보드의 SQL Editor에서 복사하여 실행해주세요.
-- 마이그레이션이 자동으로 적용되지 않은 경우를 위한 수동 실행 스크립트입니다.

-- 1. measurement_business 테이블에 누락된 컬럼 추가
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS future_measurement_date DATE;
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS measurement_date DATE;
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS business_category VARCHAR(100);

-- 2. 컬럼 코멘트 추가 (선택 사항)
COMMENT ON COLUMN measurement_business.future_measurement_date IS '금회 예정일 (향후측정예상일)';
COMMENT ON COLUMN measurement_business.measurement_date IS '금회 측정 확정일';
COMMENT ON COLUMN measurement_business.business_category IS '업종분류';

-- 3. 스키마 캐시 갱신 (API가 변경된 스키마를 인식하도록 함)
NOTIFY pgrst, 'reload schema';
