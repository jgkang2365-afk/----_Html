-- 측정 대상 사업장 테이블에 관리 상태(거래종료 등) 컬럼 추가 보장
ALTER TABLE measurement_target_business 
ADD COLUMN IF NOT EXISTS management_status text;

COMMENT ON COLUMN measurement_target_business.management_status IS '관리 상태 (예: transaction_ended)';

-- PostgREST 스키마 캐시 리로드 (Supabase API가 새 컬럼을 인식하도록 함)
NOTIFY pgrst, 'reload config';
