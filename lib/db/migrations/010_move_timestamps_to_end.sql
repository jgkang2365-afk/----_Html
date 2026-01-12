-- created_at, updated_at 컬럼을 테이블 맨 뒤로 이동
-- 생성일: 2026-01-11
--
-- PostgreSQL/Supabase에서 컬럼 순서를 변경하려면:
-- 컬럼을 삭제하고 다시 추가하면 Supabase UI에서 맨 뒤에 표시됩니다.
--
-- 주의: 이 방법은 기존 타임스탬프 데이터를 현재 시간으로 재설정합니다.
-- 하지만 created_at과 updated_at은 일반적으로 현재 시간이 기본값이므로
-- 실용적인 문제는 없습니다.
--
-- Supabase UI에서는 컬럼을 생성한 순서대로 표시하므로,
-- 컬럼을 삭제하고 다시 추가하면 맨 뒤에 표시됩니다.

-- ============================================
-- 1. business_info 테이블
-- ============================================
ALTER TABLE business_info 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at;

ALTER TABLE business_info 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ============================================
-- 2. measurement_business 테이블
-- ============================================
ALTER TABLE measurement_business 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at;

ALTER TABLE measurement_business 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ============================================
-- 3. measurement_journal 테이블
-- ============================================
-- measurement_journal은 created_by, updated_by가 뒤에 있으므로
-- 이들도 함께 맨 뒤로 이동
ALTER TABLE measurement_journal 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS updated_by;

ALTER TABLE measurement_journal 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN created_by VARCHAR(100),
    ADD COLUMN updated_by VARCHAR(100);

-- ============================================
-- 4. preliminary_survey 테이블
-- ============================================
-- preliminary_survey는 created_by가 뒤에 있으므로 함께 이동
ALTER TABLE preliminary_survey 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS created_by;

ALTER TABLE preliminary_survey 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN created_by VARCHAR(100);

-- ============================================
-- 5. measurement_summary 테이블
-- ============================================
ALTER TABLE measurement_summary 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at;

ALTER TABLE measurement_summary 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ============================================
-- 6. users 테이블
-- ============================================
ALTER TABLE users 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at;

ALTER TABLE users 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ============================================
-- 7. measurement_target_business 테이블
-- ============================================
ALTER TABLE measurement_target_business 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at;

ALTER TABLE measurement_target_business 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ============================================
-- 8. national_support_application 테이블
-- ============================================
ALTER TABLE national_support_application 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at;

ALTER TABLE national_support_application 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ============================================
-- 9. other_revenue 테이블
-- ============================================
-- other_revenue는 created_by, updated_by도 함께 이동
ALTER TABLE other_revenue 
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS updated_by;

ALTER TABLE other_revenue 
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN created_by VARCHAR(100),
    ADD COLUMN updated_by VARCHAR(100);

-- ============================================
-- 트리거 재생성 (updated_at 자동 갱신)
-- ============================================
DROP TRIGGER IF EXISTS update_business_info_updated_at ON business_info;
CREATE TRIGGER update_business_info_updated_at BEFORE UPDATE ON business_info
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_measurement_business_updated_at ON measurement_business;
CREATE TRIGGER update_measurement_business_updated_at BEFORE UPDATE ON measurement_business
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_measurement_journal_updated_at ON measurement_journal;
CREATE TRIGGER update_measurement_journal_updated_at BEFORE UPDATE ON measurement_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_preliminary_survey_updated_at ON preliminary_survey;
CREATE TRIGGER update_preliminary_survey_updated_at BEFORE UPDATE ON preliminary_survey
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_measurement_summary_updated_at ON measurement_summary;
CREATE TRIGGER update_measurement_summary_updated_at BEFORE UPDATE ON measurement_summary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_measurement_target_business_updated_at ON measurement_target_business;
CREATE TRIGGER update_measurement_target_business_updated_at BEFORE UPDATE ON measurement_target_business
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_national_support_application_updated_at ON national_support_application;
CREATE TRIGGER update_national_support_application_updated_at BEFORE UPDATE ON national_support_application
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_other_revenue_updated_at ON other_revenue;
CREATE TRIGGER update_other_revenue_updated_at BEFORE UPDATE ON other_revenue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
