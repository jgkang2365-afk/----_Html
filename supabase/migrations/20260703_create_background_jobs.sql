-- background_jobs 테이블 생성
-- 생성일: 2026-07-03

CREATE TABLE IF NOT EXISTS background_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL, -- 'email', 'k2b', 'national_support'
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'success', 'failed'
    payload JSONB NOT NULL, -- 전송 대상 정보 목록
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 설정
CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status);

COMMENT ON TABLE background_jobs IS '백그라운드 비동기 작업 큐';
COMMENT ON COLUMN background_jobs.job_type IS '작업 종류 (email, k2b, national_support)';
COMMENT ON COLUMN background_jobs.status IS '처리 상태 (pending, processing, success, failed)';
COMMENT ON COLUMN background_jobs.payload IS '작업 수행용 JSON 데이터';
COMMENT ON COLUMN background_jobs.error_message IS '에러 로그 메시지';
