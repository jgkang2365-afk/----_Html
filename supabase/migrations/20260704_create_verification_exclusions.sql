-- Create data_verification_exclusions table to allow users to exclude certain verification issues
create table if not exists public.data_verification_exclusions (
  code text not null,
  issue_type text not null, -- 'MISMATCH_NAME', 'MISMATCH_REPRESENTATIVE', etc.
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (code, issue_type)
);

-- Enable RLS
alter table public.data_verification_exclusions enable row level security;

-- Create policy to allow all access for authenticated users
create policy "Allow all access for authenticated users on exclusions"
  on public.data_verification_exclusions for all
  to authenticated
  using (true)
  with check (true);
