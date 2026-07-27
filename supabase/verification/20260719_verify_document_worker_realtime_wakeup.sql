-- 최소 pending 신호 테이블만 publication되어야 합니다.
SELECT
  EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'document_job_pending_signals'
  ) AS pending_signals_published,
  NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'document_generation_jobs'
  ) AS sensitive_jobs_not_published;

-- 원본 작업 테이블에는 INSERT 전용 트리거만 있어야 합니다.
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'document_generation_jobs'
  AND trigger_name = 'trg_document_generation_pending_wakeup';
