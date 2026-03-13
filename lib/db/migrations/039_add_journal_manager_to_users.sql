-- users 테이블에 일지담당자 여부 필드 추가
-- 생성일: 2026-03-13

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_journal_manager BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN users.is_journal_manager IS '측정일지 담당자 여부 (확정일 변경 알림 수신 대상)';
