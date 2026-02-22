-- measurement_business 테이블에 이메일 발송 상태 관리를 위한 필드 추가
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS is_email_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS email_send_history JSONB DEFAULT '[]'::JSONB;

-- measurement_journal 테이블에도 동일한 상태 필드 추가 (동기화 목적)
ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS is_email_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE measurement_journal ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMP WITH TIME ZONE;

-- 이메일 형식 제약 조건이 있다면 콤마(,)를 허용하도록 완화 (TRD 요구사항)
-- 주의: 기존에 정교한 CONSTRAINT가 없다면 생략 가능하지만, 실무적으로 VARCHAR 길이를 충분히 늘려줍니다.
ALTER TABLE measurement_business ALTER COLUMN manager_email TYPE VARCHAR(500);
ALTER TABLE measurement_journal ALTER COLUMN manager_email TYPE VARCHAR(500);
