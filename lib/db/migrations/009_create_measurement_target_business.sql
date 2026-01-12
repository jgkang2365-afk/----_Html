-- 측정 대상 사업장 계획 테이블 생성
-- 생성일: 2025-01-27
-- 목적: 25년 측정일지 데이터를 기준으로 26년 측정 대상 계획을 저장하고 진행률 파악

-- ============================================
-- 측정 대상 사업장 계획 (measurement_target_business)
-- ============================================
CREATE TABLE IF NOT EXISTS measurement_target_business (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    year INTEGER NOT NULL,
    period VARCHAR(10) NOT NULL CHECK (period IN ('상반기', '하반기')),
    business_name VARCHAR(200) NOT NULL,
    business_number VARCHAR(20),
    total_employees INTEGER,
    address VARCHAR(500),
    office_jurisdiction VARCHAR(100),
    designated_office VARCHAR(100),
    measurer VARCHAR(100),
    measurement_start_date DATE,
    measurement_end_date DATE,
    completion_status VARCHAR(20) DEFAULT '미완료' CHECK (completion_status IN ('완료', '미완료')),
    national_support_status VARCHAR(20) CHECK (national_support_status IN ('지원', '비대상')),
    manager_name VARCHAR(100),
    manager_mobile VARCHAR(20),
    manager_phone VARCHAR(20),
    future_measurement_date DATE,
    notes TEXT,
    
    -- 등록 여부 및 연결 정보
    journal_id INTEGER,
    is_registered BOOLEAN DEFAULT FALSE,
    registered_at TIMESTAMP WITH TIME ZONE,
    
    -- 계획 정보
    planned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    plan_based_year INTEGER NOT NULL, -- 계획 수립 기준 년도 (예: 25년 데이터 기준)
    plan_based_period VARCHAR(10) NOT NULL, -- 계획 수립 기준 반기
    future_measurement_period INTEGER, -- 향후측정주기(개월)
    last_measurement_date DATE, -- 전회 측정일 (계획 수립 기준)
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- 유니크 제약: code + year + period 조합은 중복 불가
    CONSTRAINT uk_measurement_target_business_code_year_period UNIQUE (code, year, period),
    
    -- 외래키: 측정일지와 연결 (옵셔널)
    CONSTRAINT fk_measurement_target_business_journal FOREIGN KEY (journal_id) 
        REFERENCES measurement_journal(id) ON DELETE SET NULL
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_code ON measurement_target_business(code);
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_year_period ON measurement_target_business(year, period);
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_business_name ON measurement_target_business(business_name);
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_designated_office ON measurement_target_business(designated_office);
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_is_registered ON measurement_target_business(is_registered);
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_journal_id ON measurement_target_business(journal_id);
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_plan_based ON measurement_target_business(plan_based_year, plan_based_period);

-- 업데이트 트리거
CREATE TRIGGER update_measurement_target_business_updated_at BEFORE UPDATE ON measurement_target_business
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
