-- users 테이블에 K2B 계정 정보 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS k2b_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS k2b_pw TEXT;

-- 보안을 위해 기본값은 NULL로 설정
COMMENT ON COLUMN users.k2b_id IS 'K2B 시스템 로그인 아이디';
COMMENT ON COLUMN users.k2b_pw IS 'K2B 시스템 로그인 비밀번호 (암호화 권장)';
