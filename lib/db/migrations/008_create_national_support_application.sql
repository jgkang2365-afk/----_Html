-- 건강디딤돌 신청결과 저장용 테이블 생성
-- 측정 대상 사업장 목록과 매칭하여 국고지원 정보를 표시하기 위한 테이블

CREATE TABLE IF NOT EXISTS national_support_application (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    year INTEGER NOT NULL,
    period VARCHAR(10) NOT NULL CHECK (period IN ('상반기', '하반기')),
    application_status VARCHAR(50), -- 신청 여부 (예: '○')
    result VARCHAR(50), -- 신청결과 (예: '대상', '비대상')
    national_support_status VARCHAR(20) CHECK (national_support_status IN ('지원', '비대상')), -- 계산된 상태
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- 같은 코드/년도/반기 조합은 하나만 있어야 함
    UNIQUE(code, year, period)
);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_national_support_application_code_year_period 
ON national_support_application(code, year, period);

CREATE INDEX IF NOT EXISTS idx_national_support_application_status 
ON national_support_application(national_support_status);
