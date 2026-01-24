-- business_info 테이블에 future_measurement_date 컬럼 추가
ALTER TABLE business_info
ADD COLUMN IF NOT EXISTS future_measurement_date DATE;

COMMENT ON COLUMN business_info.future_measurement_date IS '금회 예정일 (향후측정예상일)';

-- measurement_business 테이블에 future_measurement_date 컬럼 추가
ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS future_measurement_date DATE;

COMMENT ON COLUMN measurement_business.future_measurement_date IS '금회 예정일 (향후측정예상일)';

-- measurement_business 테이블에 measurement_date 컬럼 추가 (금회측정확정일)
ALTER TABLE measurement_business
ADD COLUMN IF NOT EXISTS measurement_date DATE;

COMMENT ON COLUMN measurement_business.measurement_date IS '금회측정확정일';
