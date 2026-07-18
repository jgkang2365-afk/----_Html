-- 1. measurement_target_business.sync_status 타입과 기본값
SELECT
  table_schema,
  table_name,
  column_name,
  data_type,
  character_maximum_length,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'measurement_target_business'
  AND column_name = 'sync_status';

-- 2. 현재 운영 상태값 분포
SELECT sync_status, COUNT(*) AS row_count
FROM public.measurement_target_business
GROUP BY sync_status
ORDER BY sync_status NULLS FIRST;

-- 3. sync_status CHECK 제약 정의
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition,
  convalidated
FROM pg_constraint
WHERE conrelid = 'public.measurement_target_business'::regclass
  AND contype = 'c'
  AND conname = 'measurement_target_business_sync_status_check';

-- 4. 20260718_harden_national_support_jobs.sql 컬럼 적용 여부
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'background_jobs'
  AND column_name IN ('available_at', 'attempt_count')
ORDER BY column_name;

-- 5. 활성 건강디딤돌 작업 중복 방지 인덱스 적용 여부
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'background_jobs'
  AND indexname = 'uq_background_jobs_active_national_support_mode';

-- 6. 원자적 큐 등록 RPC 적용 여부
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'enqueue_national_support_job';
