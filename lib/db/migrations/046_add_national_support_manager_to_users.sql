-- users 테이블에 국고 일괄 권한 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_national_support_manager BOOLEAN DEFAULT false;

COMMENT ON COLUMN users.is_national_support_manager IS '국고 일괄 조회 및 관리 권한 여부';
