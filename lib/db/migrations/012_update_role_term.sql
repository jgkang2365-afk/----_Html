-- ============================================
-- 012_update_role_term.sql
-- "측정팀 직원" → "사용자" 용어 변경
-- ============================================

-- 1. 기존 데이터 업데이트 (측정팀 직원 → 사용자)
UPDATE users
SET role = '사용자'
WHERE role = '측정팀 직원';

-- 2. CHECK 제약조건 변경
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('관리자', '사용자'));

-- 3. 기본값 변경
ALTER TABLE users ALTER COLUMN role SET DEFAULT '사용자';
