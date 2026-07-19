-- 문서 Worker Realtime wake-up 검증
SELECT
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'document_generation_jobs'
  AND trigger_name = 'trg_document_generation_pending_wakeup';

SELECT
  n.nspname AS function_schema,
  p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'notify_document_generation_pending';

-- 민감 payload가 있는 작업 테이블은 직접 publication하지 않는 것이 정상입니다.
SELECT EXISTS (
  SELECT 1
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'document_generation_jobs'
) AS document_jobs_directly_published;

-- Broadcast가 사용하는 realtime.messages publication을 확인합니다.
SELECT *
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'realtime'
  AND tablename = 'messages';
