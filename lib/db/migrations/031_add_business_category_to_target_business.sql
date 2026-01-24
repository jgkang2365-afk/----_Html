
-- Add business_category to measurement_target_business table
ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS business_category VARCHAR(100);

-- Ensure we can update it
COMMENT ON COLUMN measurement_target_business.business_category IS '업종분류 (사업장 관리 화면에서 직접 수정 가능)';
