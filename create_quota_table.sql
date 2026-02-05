-- 지정지청 인가 갯수 관리 테이블 생성
create table if not exists designated_office_quotas (
  id bigint primary key generated always as identity,
  year int not null,
  period text not null, -- '상반기', '하반기'
  office_name text not null, -- '천안', '대전', '평택', '경기'
  quota int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(year, period, office_name)
);

-- RLS 정책 설정 (필요 시)
alter table designated_office_quotas enable row level security;

drop policy if exists "Enable read access for all users" on designated_office_quotas;
create policy "Enable read access for all users" on designated_office_quotas
  for select using (true);

drop policy if exists "Enable insert/update for authenticated users only" on designated_office_quotas;
create policy "Enable insert/update for authenticated users only" on designated_office_quotas
  for all using (auth.role() = 'authenticated');

-- 기존 데이터 중 2026년 이전 데이터 삭제
delete from designated_office_quotas where year < 2026;

-- 기본 데이터 삽입 (2026년 상/하반기)
-- 천안: 140, 대전: 160, 평택: 20, 경기: 40
insert into designated_office_quotas (year, period, office_name, quota)
select y, p, o, q
from (
  select unnest(array[2026]) as y
) years,
(
  select unnest(array['상반기', '하반기']) as p
) periods,
(
  values 
    ('천안', 140),
    ('대전', 160),
    ('평택', 20),
    ('경기', 40)
) as offices(o, q)
on conflict (year, period, office_name) do nothing;

-- 인가 갯수 변경 이력 관리 테이블 생성
create table if not exists designated_office_quota_history (
  id bigint primary key generated always as identity,
  quota_id bigint references designated_office_quotas(id) on delete cascade,
  previous_quota int not null,
  new_quota int not null,
  change_reason text,
  changed_by uuid default auth.uid(),
  created_at timestamptz default now()
);

-- 이력 테이블 RLS 설정
alter table designated_office_quota_history enable row level security;

drop policy if exists "Enable read access for all users" on designated_office_quota_history;
create policy "Enable read access for all users" on designated_office_quota_history
  for select using (true);

drop policy if exists "Enable insert for authenticated users only" on designated_office_quota_history;
create policy "Enable insert for authenticated users only" on designated_office_quota_history
  for insert with check (auth.role() = 'authenticated');
