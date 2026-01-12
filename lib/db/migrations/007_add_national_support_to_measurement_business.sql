-- measurement_business 테이블에 national_support_status 컬럼 추가
-- 건강디딤돌 신청결과를 측정일지 생성 전에도 저장할 수 있도록 함

-- 컬럼이 이미 있는지 확인하고 없으면 추가
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'measurement_business' 
        AND column_name = 'national_support_status'
    ) THEN
        ALTER TABLE measurement_business
        ADD COLUMN national_support_status VARCHAR(20) CHECK (national_support_status IN ('지원', '비대상'));
        
        -- 인덱스 추가 (검색 최적화)
        CREATE INDEX IF NOT EXISTS idx_measurement_business_national_support 
        ON measurement_business(national_support_status);
    END IF;
END $$;
