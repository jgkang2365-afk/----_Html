-- background_jobs의 기존 payload/status 계약은 유지하고 관측 결과만 별도 저장한다.
ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_result JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.background_jobs.started_at IS 'worker가 작업을 선점한 실제 시각';
COMMENT ON COLUMN public.background_jobs.finished_at IS 'worker가 최종 상태를 저장한 실제 시각';
COMMENT ON COLUMN public.background_jobs.execution_result IS '민감정보를 제외한 작업별 사실 기반 실행 결과';

-- 수동/스케줄 요청을 이후 상태 UI에서 구분한다. 기존 함수 시그니처는 바꾸지 않는다.
CREATE OR REPLACE FUNCTION public.enqueue_k2b_verify_job(
  p_result_date DATE,
  p_requested_by BIGINT DEFAULT NULL
) RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.enqueue_k2b_automation_job(
    'k2b_verify',
    jsonb_build_object(
      'resultDate', p_result_date,
      'requestedBy', p_requested_by,
      'trigger', CASE WHEN p_requested_by IS NULL THEN 'scheduled' ELSE 'manual' END,
      'serializationDisposition', 'accepted_without_active_k2b'
    )
  );
$$;

-- CREATE OR REPLACE 뒤 기본/직접 실행권한이 다시 열리지 않도록 같은 migration에서 고정한다.
REVOKE ALL ON FUNCTION public.enqueue_k2b_verify_job(DATE, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_verify_job(DATE, BIGINT)
  TO service_role;

NOTIFY pgrst, 'reload schema';
