-- ============================================
-- 013_reset_admin_password.sql
-- 관리자(강종구) 비밀번호 초기화
-- ============================================

-- 강종구 사용자의 비밀번호를 NULL로 설정 (초기화)
UPDATE users
SET password_hash = NULL,
    updated_at = NOW()
WHERE name = '강종구' AND role = '관리자';

-- 결과 확인 (실행 후 수동으로 확인)
-- SELECT name, role, password_hash IS NULL as password_not_set FROM users WHERE name = '강종구';
