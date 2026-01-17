-- ============================================
-- users 테이블에 survey_code 필드 추가
-- 사용자별 공시료 번호 등록을 위한 필드
-- 생성일: 2025-01-XX
-- ============================================

-- survey_code 필드 추가 (VARCHAR(10), NULL 허용)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS survey_code VARCHAR(10);

-- 인덱스 추가 (선택사항, 공시료 코드로 검색할 경우)
CREATE INDEX IF NOT EXISTS idx_users_survey_code ON users(survey_code);

-- 주석 추가
COMMENT ON COLUMN users.survey_code IS '사용자별 공시료 번호';

DO $$
BEGIN
    RAISE NOTICE 'users 테이블에 survey_code 필드 추가 완료';
END $$;
