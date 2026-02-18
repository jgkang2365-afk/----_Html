-- sync_log 테이블에 상세 변경 내역을 저장할 컬럼 추가
-- 이 쿼리를 Supabase 대시보드의 SQL Editor에서 실행해주세요.

ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS change_details JSONB;

COMMENT ON COLUMN sync_log.change_details IS '동기화 변경 상세 내역 (JSON 형식으로 저장)';

-- 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
