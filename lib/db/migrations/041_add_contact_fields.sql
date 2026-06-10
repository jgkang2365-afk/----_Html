-- 041_add_contact_fields.sql
-- 측정사업장 및 측정대상사업장 등에 전화번호, 팩스, 담당자 직통번호 필드 추가

-- 1. measurement_business 테이블 (측정사업장.xls 동기화 대상)
ALTER TABLE measurement_business 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS fax TEXT,
ADD COLUMN IF NOT EXISTS manager_phone TEXT;

COMMENT ON COLUMN measurement_business.phone IS '사업장 대표 전화번호 (L열)';
COMMENT ON COLUMN measurement_business.fax IS '사업장 팩스번호 (M열)';
COMMENT ON COLUMN measurement_business.manager_phone IS '담당자 직통 전화번호 (BM열)';

-- 2. measurement_target_business 테이블 (측정대상관리)
ALTER TABLE measurement_target_business 
ADD COLUMN IF NOT EXISTS fax TEXT,
ADD COLUMN IF NOT EXISTS manager_phone TEXT;

COMMENT ON COLUMN measurement_target_business.fax IS '사업장 팩스번호';
COMMENT ON COLUMN measurement_target_business.manager_phone IS '담당자 직통 전화번호';

-- 3. measurement_journal 테이블 (측정일지 기록)
ALTER TABLE measurement_journal 
ADD COLUMN IF NOT EXISTS manager_phone TEXT;

COMMENT ON COLUMN measurement_journal.manager_phone IS '담당자 직통 전화번호';
