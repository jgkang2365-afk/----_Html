-- measurement_journal 테이블에 계산서 발행처 정보 필드 추가
ALTER TABLE measurement_journal 
ADD COLUMN IF NOT EXISTS invoice_business_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS invoice_business_number VARCHAR(20);

-- 설명 추가 (Comment)
COMMENT ON COLUMN measurement_journal.invoice_business_name IS '계산서 발행처 상호';
COMMENT ON COLUMN measurement_journal.invoice_business_number IS '계산서 발행처 사업자번호';
