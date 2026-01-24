-- ============================================
-- 30. 측정주기 제약조건 및 FK 완화 (수시 측정 지원)
-- ============================================

-- 1. 측정일지 테이블의 측정주기(measurement_period) CHECK 제약조건 완화
ALTER TABLE measurement_journal DROP CONSTRAINT IF EXISTS measurement_journal_measurement_period_check;
ALTER TABLE measurement_journal ADD CONSTRAINT measurement_journal_measurement_period_check 
    CHECK (measurement_period IN ('상반기', '하반기', '상반기(수시)', '하반기(수시)', '1분기', '2분기', '3분기', '4분기'));

-- 2. 측정사업장 테이블의 측정주기(period) CHECK 제약조건 완화
ALTER TABLE measurement_business DROP CONSTRAINT IF EXISTS measurement_business_period_check;
ALTER TABLE measurement_business ADD CONSTRAINT measurement_business_period_check 
    CHECK (period IN ('상반기', '하반기', '상반기(수시)', '하반기(수시)', '1분기', '2분기', '3분기', '4분기'));

-- 3. FK 제약조건 완화 (measurement_business와의 엄격한 연결 해제)
-- 기존: measurement_journal(code, year, period) -> measurement_business(code, year, period)
-- 문제: '상반기(수시)' 일지가 '상반기' 사업장 정보를 참조할 수 없음 (PK 불일치)
-- 해결: 복합 FK 제거하고, 코드(code)만 참조하는 FK로 대체 (또는 FK 제거 후 App단 관리)

DO $$ 
BEGIN
    -- 기존 복합 FK 제거
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_measurement_journal_code') THEN
        ALTER TABLE measurement_journal DROP CONSTRAINT fk_measurement_journal_code;
    END IF;

    -- 새로운 FK 추가 (business_info 참조 - 선택사항)
    -- 주의: business_info에 해당 코드가 있어야 함. 
    BEGIN
        ALTER TABLE measurement_journal 
        ADD CONSTRAINT fk_measurement_journal_business_info 
        FOREIGN KEY (code) REFERENCES business_info(code);
    EXCEPTION WHEN unique_violation OR foreign_key_violation THEN
        -- 외래키 제약조건 위반 시 (business_info에 없는 코드가 있을 경우) FK 생성을 건너뜀
        RAISE NOTICE 'Could not add FK to business_info due to existing data violations. Proceeding without FK.';
    WHEN OTHERS THEN
        -- 그 외 오류 발생 시 로그만 남기고 진행
        RAISE NOTICE 'Error adding FK: %. Proceeding without FK.', SQLERRM;
    END;
END $$;

-- 4. PostgREST 캐시 갱신
NOTIFY pgrst, 'reload config';
