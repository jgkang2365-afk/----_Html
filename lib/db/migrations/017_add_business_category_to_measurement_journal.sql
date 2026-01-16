-- ============================================
-- measurement_journal 테이블에 업종 필드 추가
-- 사업장정보의 업종 정보를 측정일지에도 저장
-- ============================================

ALTER TABLE measurement_journal
ADD COLUMN IF NOT EXISTS business_category VARCHAR(200); -- 업종

-- 인덱스 추가 (선택사항)
CREATE INDEX IF NOT EXISTS idx_measurement_journal_business_category ON measurement_journal(business_category);
