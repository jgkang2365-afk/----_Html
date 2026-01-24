
-- Add task column to measurement_target_business table
ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS task VARCHAR(500);

-- Add comment
COMMENT ON COLUMN measurement_target_business.task IS '작업 내용 (사업장 관리 화면에서 직접 수정 가능)';
