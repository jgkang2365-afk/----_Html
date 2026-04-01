-- 지청별 지정한계 메모장용 테이블 생성
CREATE TABLE IF NOT EXISTS quota_memos (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  is_shared boolean default true,
  user_id uuid references auth.users(id) on delete cascade,
  user_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS 활성화
ALTER TABLE quota_memos ENABLE ROW LEVEL SECURITY;

-- 조회: 인증된 모든 사용자는 접근 가능 (is_shared 필드에 따른 필터링은 API/앱 단에서 제어)
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON quota_memos;
CREATE POLICY "Enable read access for all authenticated users" ON quota_memos
  FOR SELECT USING (auth.role() = 'authenticated');

-- 삽입: 인증된 사용자만 가능
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON quota_memos;
CREATE POLICY "Enable insert for authenticated users only" ON quota_memos
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  
-- 수정: 본인이 작성한 메모만 수정 가능
DROP POLICY IF EXISTS "Enable update for owner" ON quota_memos;
CREATE POLICY "Enable update for owner" ON quota_memos
  FOR UPDATE USING (auth.uid() = user_id);

-- 삭제: 본인이 작성한 메모만 삭제 가능
DROP POLICY IF EXISTS "Enable delete for owner" ON quota_memos;
CREATE POLICY "Enable delete for owner" ON quota_memos
  FOR DELETE USING (auth.uid() = user_id);

-- 인덱스 추가 (조회 성능 최적화용)
CREATE INDEX IF NOT EXISTS quota_memos_created_at_idx ON quota_memos(created_at DESC);
