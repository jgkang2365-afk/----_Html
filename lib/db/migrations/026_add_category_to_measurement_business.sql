-- measurement_business 테이블에 business_category 컬럼 추가
ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS business_category VARCHAR(100);

COMMENT ON COLUMN measurement_business.business_category IS '업종분류';
