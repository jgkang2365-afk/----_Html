-- 향후측정주기 컬럼 추가
-- measurement_business 테이블에 향후측정주기(개월) 컬럼 추가

ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS future_measurement_period INTEGER; -- 향후측정주기 (개월, 예: 6, 12)

-- 인덱스 추가 (향후측정주기 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_measurement_business_future_period ON measurement_business(future_measurement_period);

-- business_info 테이블에도 향후측정주기 추가 (사업장정보.xls에서 관리하는 경우)
ALTER TABLE business_info
ADD COLUMN IF NOT EXISTS future_measurement_period INTEGER; -- 향후측정주기 (개월)

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_business_info_future_period ON business_info(future_measurement_period);
