-- 측정주기(period) 제약조건 완화 마이그레이션
-- 상반기, 하반기 외에 (수시) 등이 포함된 값도 허용하도록 수정

-- 1. measurement_business
ALTER TABLE measurement_business DROP CONSTRAINT IF EXISTS measurement_business_period_check;
-- 제약조건을 삭제하거나 범위를 넓힘 (여기서는 유연하게 텍스트 허용하되, App 레벨에서 관리 권장)
-- 또는 확장된 목록으로 재생성:
ALTER TABLE measurement_business ADD CONSTRAINT measurement_business_period_check 
    CHECK (period IN ('상반기', '하반기', '상반기(수시)', '하반기(수시)', '1분기', '2분기', '3분기', '4분기'));

-- 2. measurement_journal
ALTER TABLE measurement_journal DROP CONSTRAINT IF EXISTS measurement_journal_measurement_period_check;
ALTER TABLE measurement_journal ADD CONSTRAINT measurement_journal_measurement_period_check 
    CHECK (measurement_period IN ('상반기', '하반기', '상반기(수시)', '하반기(수시)', '1분기', '2분기', '3분기', '4분기'));

-- 3. measurement_target_business
ALTER TABLE measurement_target_business DROP CONSTRAINT IF EXISTS measurement_target_business_period_check;
ALTER TABLE measurement_target_business ADD CONSTRAINT measurement_target_business_period_check 
    CHECK (period IN ('상반기', '하반기', '상반기(수시)', '하반기(수시)', '1분기', '2분기', '3분기', '4분기'));

-- 4. national_support_application (혹시 제약조건이 있다면)
-- 이 테이블은 007 마이그레이션 등을 확인해야 하나, 보통 텍스트로 두는 경우가 많음.
-- 확인 후 필요하면 추가. (일단 안전하게 pass)

-- PostgREST 캐시 갱신
NOTIFY pgrst, 'reload config';
