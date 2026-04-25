-- 044_fix_users_cascade_delete.sql
-- 사용자 삭제 시 관련 데이터를 자동으로 삭제하기 위한 CASCADE 제약 조건 추가

DO $$ 
BEGIN
    -- 1. quota_memos 테이블 처리
    -- 기존 외래키 제약 조건이 있는지 확인하고 삭제 (이름은 표준 관례에 따라 quota_memos_user_id_fkey 로 가정하거나 시스템 카탈로그에서 조회)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'quota_memos' AND constraint_type = 'FOREIGN KEY'
    ) THEN
        -- 실제 제약 조건 이름을 조회하여 삭제
        EXECUTE (
            SELECT 'ALTER TABLE quota_memos DROP CONSTRAINT ' || constraint_name
            FROM information_schema.key_column_usage
            WHERE table_name = 'quota_memos' AND column_name = 'user_id'
            LIMIT 1
        );
    END IF;

    -- 새 CASCADE 제약 조건 추가
    ALTER TABLE quota_memos 
    ADD CONSTRAINT quota_memos_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

    -- 2. notifications 테이블 (이미 설정되어 있을 수 있으나 재확인/재설정)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'notifications' AND constraint_type = 'FOREIGN KEY'
    ) THEN
        EXECUTE (
            SELECT 'ALTER TABLE notifications DROP CONSTRAINT ' || constraint_name
            FROM information_schema.key_column_usage
            WHERE table_name = 'notifications' AND column_name = 'user_id'
            LIMIT 1
        );
    END IF;

    ALTER TABLE notifications 
    ADD CONSTRAINT notifications_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

    -- 3. measurement_target_business 테이블 처리
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'measurement_target_business' AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'measurement_target_business_measurer_id_fkey'
    ) THEN
        ALTER TABLE measurement_target_business DROP CONSTRAINT measurement_target_business_measurer_id_fkey;
    END IF;

    ALTER TABLE measurement_target_business 
    ADD CONSTRAINT measurement_target_business_measurer_id_fkey 
    FOREIGN KEY (measurer_id) REFERENCES users(id) ON DELETE SET NULL;

END $$;

COMMENT ON TABLE quota_memos IS '지청별 인가 갯수 메모 (사용자 삭제 시 연쇄 삭제 설정 완료)';
COMMENT ON TABLE notifications IS '시스템 알림 (사용자 삭제 시 연쇄 삭제 설정 완료)';
