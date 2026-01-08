-- 측정일지 관리 시스템 초기 스키마
-- 생성일: 2025-01-27

-- ============================================
-- 1. 사업장정보 (business_info)
-- ============================================
CREATE TABLE IF NOT EXISTS business_info (
    code VARCHAR(50) PRIMARY KEY,
    business_name VARCHAR(200) NOT NULL,
    business_number VARCHAR(20),
    address1 VARCHAR(500),
    address2 VARCHAR(500),
    phone VARCHAR(20),
    fax VARCHAR(20),
    representative_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_business_info_name ON business_info(business_name);

-- ============================================
-- 2. 측정사업장 (measurement_business)
-- ============================================
CREATE TABLE IF NOT EXISTS measurement_business (
    code VARCHAR(50) PRIMARY KEY,
    year INTEGER NOT NULL,
    period VARCHAR(10) NOT NULL CHECK (period IN ('상반기', '하반기')),
    business_name VARCHAR(200) NOT NULL,
    business_number VARCHAR(20),
    total_employees INTEGER,
    address VARCHAR(500),
    office_jurisdiction VARCHAR(100),
    measurement_start_date DATE,
    measurement_end_date DATE,
    completion_status VARCHAR(20) CHECK (completion_status IN ('완료', '미완료')),
    measurer VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_measurement_business_year_period ON measurement_business(year, period);
CREATE INDEX IF NOT EXISTS idx_measurement_business_name ON measurement_business(business_name);
CREATE INDEX IF NOT EXISTS idx_measurement_business_status ON measurement_business(completion_status);

-- ============================================
-- 3. 측정일지 (measurement_journal) - 가장 중요
-- ============================================
CREATE TABLE IF NOT EXISTS measurement_journal (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    measurement_year INTEGER NOT NULL,
    measurement_period VARCHAR(10) NOT NULL CHECK (measurement_period IN ('상반기', '하반기')),
    note VARCHAR(50),
    designated_office VARCHAR(100) NOT NULL,
    document_number VARCHAR(20) UNIQUE,
    sequence_number VARCHAR(10),
    five_plus_sequence VARCHAR(10),
    measurement_start_date DATE,
    measurement_end_date DATE,
    completion_status VARCHAR(20) NOT NULL DEFAULT '미완료' CHECK (completion_status IN ('완료', '미완료')),
    measurer VARCHAR(100),
    office_jurisdiction VARCHAR(100),
    business_name VARCHAR(200) NOT NULL,
    total_employees INTEGER,
    business_number VARCHAR(20),
    industrial_accident_number VARCHAR(50),
    representative_name VARCHAR(100),
    national_support_status VARCHAR(20) CHECK (national_support_status IN ('지원', '비대상')),
    address VARCHAR(500),
    phone VARCHAR(20),
    fax VARCHAR(20),
    manager_name VARCHAR(100),
    manager_position VARCHAR(50),
    manager_mobile VARCHAR(20),
    manager_email VARCHAR(100),
    k2b_send_date DATE,
    k2b_sender VARCHAR(100),
    invoice_email VARCHAR(100),
    electronic_invoice_date DATE,
    measurement_fee_total DECIMAL(15,2),
    measurement_fee_business DECIMAL(15,2),
    measurement_fee_national DECIMAL(15,2),
    deposit_total DECIMAL(15,2),
    deposit_date_business DATE,
    deposit_amount_business DECIMAL(15,2),
    deposit_date_national DATE,
    deposit_amount_national DECIMAL(15,2),
    special_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    
    -- 외래키
    CONSTRAINT fk_measurement_journal_code FOREIGN KEY (code) REFERENCES measurement_business(code)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_measurement_journal_code ON measurement_journal(code);
CREATE INDEX IF NOT EXISTS idx_measurement_journal_year_period ON measurement_journal(measurement_year, measurement_period);
CREATE INDEX IF NOT EXISTS idx_measurement_journal_business_name ON measurement_journal(business_name);
CREATE INDEX IF NOT EXISTS idx_measurement_journal_designated_office ON measurement_journal(designated_office);
CREATE INDEX IF NOT EXISTS idx_measurement_journal_document_number ON measurement_journal(document_number);
CREATE INDEX IF NOT EXISTS idx_measurement_journal_status ON measurement_journal(completion_status);

-- ============================================
-- 4. 예비조사 (preliminary_survey)
-- ============================================
CREATE TABLE IF NOT EXISTS preliminary_survey (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50),
    measurement_date DATE NOT NULL,
    end_date DATE,
    measurement_weekdays VARCHAR(100),
    business_name VARCHAR(200) NOT NULL,
    measurer VARCHAR(200),
    survey_code VARCHAR(10),
    address VARCHAR(500),
    preliminary_surveyor VARCHAR(200),
    actual_measurer VARCHAR(200),
    report_writer VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100),
    
    -- 외래키
    CONSTRAINT fk_preliminary_survey_code FOREIGN KEY (code) REFERENCES measurement_business(code)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_code ON preliminary_survey(code);
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_date ON preliminary_survey(measurement_date);
CREATE INDEX IF NOT EXISTS idx_preliminary_survey_business_name ON preliminary_survey(business_name);

-- ============================================
-- 5. 측정정보 요약 (measurement_summary)
-- ============================================
CREATE TABLE IF NOT EXISTS measurement_summary (
    id SERIAL PRIMARY KEY,
    journal_id INTEGER NOT NULL,
    survey_id INTEGER,
    code VARCHAR(50),
    measurement_year INTEGER,
    measurement_period VARCHAR(10),
    note VARCHAR(50),
    document_number VARCHAR(20),
    sequence_number VARCHAR(10),
    five_plus_sequence VARCHAR(10),
    measurement_start_date DATE,
    measurement_end_date DATE,
    measurer VARCHAR(100),
    preliminary_surveyor VARCHAR(200),
    survey_code VARCHAR(10),
    office_jurisdiction VARCHAR(100),
    business_name VARCHAR(200),
    total_employees INTEGER,
    business_number VARCHAR(20),
    industrial_accident_number VARCHAR(50),
    national_support_status VARCHAR(20),
    manager_name VARCHAR(100),
    manager_position VARCHAR(50),
    manager_mobile VARCHAR(20),
    manager_email VARCHAR(100),
    k2b_send_date DATE,
    k2b_sender VARCHAR(100),
    measurement_fee_business DECIMAL(15,2),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- 외래키
    CONSTRAINT fk_measurement_summary_journal FOREIGN KEY (journal_id) REFERENCES measurement_journal(id) ON DELETE CASCADE,
    CONSTRAINT fk_measurement_summary_survey FOREIGN KEY (survey_id) REFERENCES preliminary_survey(id) ON DELETE SET NULL
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_measurement_summary_journal_id ON measurement_summary(journal_id);
CREATE INDEX IF NOT EXISTS idx_measurement_summary_year_period ON measurement_summary(measurement_year, measurement_period);

-- ============================================
-- 6. 동기화 로그 (sync_log)
-- ============================================
CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(200) NOT NULL,
    sync_type VARCHAR(50) NOT NULL,
    sync_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    sync_end_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('성공', '실패', '진행중')),
    records_processed INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sync_log_file_name ON sync_log(file_name);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);
CREATE INDEX IF NOT EXISTS idx_sync_log_created_at ON sync_log(created_at);

-- ============================================
-- 7. 사용자 (users) - 인증용
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT '측정팀 직원' CHECK (role IN ('관리자', '측정팀 직원')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================
-- 업데이트 트리거 함수 (updated_at 자동 갱신)
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 각 테이블에 트리거 적용
CREATE TRIGGER update_business_info_updated_at BEFORE UPDATE ON business_info
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_measurement_business_updated_at BEFORE UPDATE ON measurement_business
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_measurement_journal_updated_at BEFORE UPDATE ON measurement_journal
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_preliminary_survey_updated_at BEFORE UPDATE ON preliminary_survey
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_measurement_summary_updated_at BEFORE UPDATE ON measurement_summary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

