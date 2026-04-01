-- 지청별 지정한계 메모장용 테이블 생성 (정수 ID 유저 시스템 대응 버전)
DROP TABLE IF EXISTS quota_memos;

CREATE TABLE quota_memos (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  is_shared boolean default true,
  user_id integer references public.users(id) on delete cascade, -- 정수형 ID 사용
  user_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS 활성화 (기본 프레임워크만 유지)
ALTER TABLE quota_memos ENABLE ROW LEVEL SECURITY;

-- 모든 사용자 조회 허용 (is_shared 필터링은 API에서 처리)
DROP POLICY IF EXISTS "Enable read access for all users" ON quota_memos;
CREATE POLICY "Enable read access for all users" ON quota_memos
  FOR SELECT USING (true);

-- 모든 인증된 사용자 삽입 허용 (권한은 API에서 처리)
DROP POLICY IF EXISTS "Enable insert for all users" ON quota_memos;
CREATE POLICY "Enable insert for all users" ON quota_memos
  FOR INSERT WITH CHECK (true);

-- 수정/삭제 권한 (서비스 롤을 사용하는 API에서 직접 처리하므로 DB 정책은 단순화)
DROP POLICY IF EXISTS "Enable update/delete for service role" ON quota_memos;
CREATE POLICY "Enable update/delete for service role" ON quota_memos
  FOR ALL USING (true);

-- 인덱스 추가 (조회 성능 최적화용)
CREATE INDEX IF NOT EXISTS quota_memos_created_at_idx ON quota_memos(created_at DESC);
CREATE INDEX IF NOT EXISTS quota_memos_user_id_idx ON quota_memos(user_id);
