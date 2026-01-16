-- ============================================
-- measurement_journal 테이블에 UNIQUE 제약조건 추가
-- code + measurement_year + measurement_period 조합은 중복 불가
-- 생성일: 2025-01-XX
-- ============================================

-- 기존 중복 데이터 확인
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT code, measurement_year, measurement_period, COUNT(*) as cnt
        FROM measurement_journal
        GROUP BY code, measurement_year, measurement_period
        HAVING COUNT(*) > 1
    ) duplicates;
    
    IF duplicate_count > 0 THEN
        RAISE NOTICE '경고: 중복 데이터가 %건 발견되었습니다. 제약조건 추가 전에 중복 데이터를 정리해야 합니다.', duplicate_count;
        RAISE NOTICE '중복 데이터 조회 쿼리:';
        RAISE NOTICE 'SELECT code, measurement_year, measurement_period, COUNT(*) as cnt, array_agg(id) as ids';
        RAISE NOTICE 'FROM measurement_journal';
        RAISE NOTICE 'GROUP BY code, measurement_year, measurement_period';
        RAISE NOTICE 'HAVING COUNT(*) > 1;';
    ELSE
        RAISE NOTICE '중복 데이터가 없습니다. 제약조건을 추가합니다.';
    END IF;
END $$;

-- 기존 제약조건이 있으면 제거
ALTER TABLE measurement_journal 
    DROP CONSTRAINT IF EXISTS uk_measurement_journal_code_year_period;

-- UNIQUE 제약조건 추가
-- 같은 code, measurement_year, measurement_period 조합은 중복 불가
ALTER TABLE measurement_journal 
    ADD CONSTRAINT uk_measurement_journal_code_year_period 
    UNIQUE (code, measurement_year, measurement_period);

-- 인덱스는 UNIQUE 제약조건이 자동으로 생성하므로 추가 작업 불필요

DO $$
BEGIN
    RAISE NOTICE 'UNIQUE 제약조건 추가 완료: uk_measurement_journal_code_year_period';
END $$;
