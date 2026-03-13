-- [긴급] 고도화 기능(알림 시스템) 적용을 위한 SQL 스크립트
-- Supabase 대시보드(https://supabase.com/dashboard)의 SQL Editor에서 아래 내용을 복사하여 실행해주세요.

-- 1. users 테이블에 누락된 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_journal_manager BOOLEAN DEFAULT FALSE;

-- 2. notifications 테이블 생성
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'INFO', -- INFO, WARNING, SUCCESS
    is_read BOOLEAN DEFAULT FALSE,
    related_code VARCHAR(50), -- 관련 사업장 코드
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RLS(Row Level Security) 설정 (보안) - 현재 시스템 구조에 맞춰 비활성화하거나 정책 추가
-- 여기서는 일단 활성화하고 기본 정책을 추가합니다.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 모든 인증된 사용자가 자신의 알림을 볼 수 있도록 허용 (세션 기반 권한 체크를 사용하는 경우)
-- 만약 세션 userId를 직접 사용한다면 아래 정책이 필요합니다.
CREATE POLICY "Users can view their own notifications"
ON notifications FOR SELECT
USING (TRUE); -- 애플리케이션 레벨에서 세션 필터링을 하므로 TRUE로 설정하거나, auth.uid()를 사용하세요.

CREATE POLICY "Users can update their own notifications"
ON notifications FOR UPDATE
USING (TRUE);

-- 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- 3. 스키마 캐시 갱신 (PGRST가 변경된 컬럼을 즉시 인식하도록 함)
NOTIFY pgrst, 'reload schema';
