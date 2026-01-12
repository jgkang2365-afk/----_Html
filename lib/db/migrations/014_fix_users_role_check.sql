-- ============================================
-- 014_fix_users_role_check.sql
-- users_role_check 제약조건 명시적으로 재설정
-- ============================================

-- 1. 기존 제약조건 제거
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. 새로운 제약조건 추가 (명시적으로)
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('관리자', '사용자'));

-- 3. 기본값 확인 및 설정
ALTER TABLE users ALTER COLUMN role SET DEFAULT '사용자';
