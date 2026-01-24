-- 측정 대상 사업장 테이블에 관리 상태(거래종료 등) 컬럼 추가
ALTER TABLE measurement_target_business
ADD COLUMN IF NOT EXISTS management_status text;

COMMENT ON COLUMN measurement_target_business.management_status IS '관리 상태 (예: transaction_ended)';
