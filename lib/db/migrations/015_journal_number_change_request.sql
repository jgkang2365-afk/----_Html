-- ============================================
-- 번호 변경 요청 테이블
-- 공문연번, 연번, 5인 이상 연번 변경 시 관리자 승인 필요
-- ============================================
CREATE TABLE IF NOT EXISTS journal_number_change_request (
    id SERIAL PRIMARY KEY,
    journal_id INTEGER NOT NULL,
    requested_by VARCHAR(100) NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- 변경 요청 필드
    old_document_number VARCHAR(20),
    new_document_number VARCHAR(20),
    old_sequence_number VARCHAR(10),
    new_sequence_number VARCHAR(10),
    old_five_plus_sequence VARCHAR(10),
    new_five_plus_sequence VARCHAR(10),
    
    -- 승인 정보
    status VARCHAR(20) NOT NULL DEFAULT '대기' CHECK (status IN ('대기', '승인', '거부')),
    approved_by VARCHAR(100),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    
    -- 외래키
    CONSTRAINT fk_journal_number_change_request_journal FOREIGN KEY (journal_id) REFERENCES measurement_journal(id) ON DELETE CASCADE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_journal_number_change_request_journal_id ON journal_number_change_request(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_number_change_request_status ON journal_number_change_request(status);
CREATE INDEX IF NOT EXISTS idx_journal_number_change_request_requested_at ON journal_number_change_request(requested_at);
