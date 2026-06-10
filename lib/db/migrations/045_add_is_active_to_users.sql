-- 사용자 계정 활성/비활성 필드 추가
-- 생성일: 2026-04-25

-- 1. users 테이블에 is_active 컬럼 추가 (기본값 true)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_active') THEN
        ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

COMMENT ON COLUMN users.is_active IS '계정 활성 상태 (true: 사용 가능, false: 접속 차단)';
