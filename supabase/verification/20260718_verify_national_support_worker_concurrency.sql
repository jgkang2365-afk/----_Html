-- 결과가 1행이고 index_name이 표시되면 동시 실행 제한 인덱스가 적용된 상태입니다.
SELECT
  indexname AS index_name,
  indexdef AS index_definition
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'background_jobs'
  AND indexname = 'uq_background_jobs_one_processing_national_support';

-- active_count는 항상 0 또는 1이어야 합니다.
SELECT count(*) AS active_count
FROM public.background_jobs
WHERE job_type = 'national_support'
  AND status = 'processing';

