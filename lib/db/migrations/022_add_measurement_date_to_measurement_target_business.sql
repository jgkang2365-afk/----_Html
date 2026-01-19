-- ============================================
-- measurement_target_business 테이블에 measurement_date 필드 추가
-- 예비조사의 측정일을 저장하는 필드
-- 생성일: 2025-01-XX
-- ============================================

-- measurement_date 필드 추가 (DATE, NULL 허용)
ALTER TABLE measurement_target_business
    ADD COLUMN IF NOT EXISTS measurement_date DATE;

-- 인덱스 추가 (측정일 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_measurement_date ON measurement_target_business(measurement_date);

-- 주석 추가
COMMENT ON COLUMN measurement_target_business.measurement_date IS '예비조사의 측정일 (preliminary_survey.measurement_date에서 자동 반영)';

DO $$
BEGIN
    RAISE NOTICE 'measurement_target_business 테이블에 measurement_date 필드 추가 완료';
END $$;
