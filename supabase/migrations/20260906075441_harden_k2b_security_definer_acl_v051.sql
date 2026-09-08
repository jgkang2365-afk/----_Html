-- K2B queue RPC는 service-role 서버 경로에서만 실행한다.
-- 기존 적용 migration은 보존하고 실제 role direct grant를 forward-only로 회수한다.
REVOKE ALL ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_k2b_verify_job(DATE, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_verify_job(DATE, BIGINT)
  TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_k2b_upload_job(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_upload_job(JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
