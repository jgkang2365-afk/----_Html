-- 사용자 테이블 구조 변경: 간단한 이름 기반 인증 시스템
-- 생성일: 2025-01-27

-- 1. email 컬럼 제약조건 제거 (name을 unique identifier로 사용)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- 2. name 컬럼에 UNIQUE 제약조건 추가 (이미 존재하면 에러 무시 가능)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_name_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_name_key UNIQUE (name);
    END IF;
END $$;

-- 3. password_hash 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- 4. 인덱스 재생성 (name 기반)
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);

-- 참고: 초기 사용자 데이터는 scripts/init-users.ts 스크립트를 실행하여 생성합니다.
-- 실행 방법: npm run init-users
