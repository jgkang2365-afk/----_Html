BEGIN;

ALTER TABLE public.document_generation_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.document_generation_jobs.cancel_requested_at IS
  '사용자 또는 API가 문서 생성 취소를 요청한 시각';
COMMENT ON COLUMN public.document_generation_jobs.cancel_requested_by IS
  '문서 생성 취소를 요청한 사용자';
COMMENT ON COLUMN public.document_generation_jobs.cancelled_at IS
  'Worker 또는 PENDING 취소가 안전하게 종료된 시각';

ALTER TABLE public.document_generation_jobs
  DROP CONSTRAINT IF EXISTS document_generation_jobs_status_check;

ALTER TABLE public.document_generation_jobs
  ADD CONSTRAINT document_generation_jobs_status_check
  CHECK (
    status IN (
      'NOT_REQUESTED',
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'PARTIAL_SUCCESS',
      'FAILED',
      'CANCELLED'
    )
  );

-- 기존 SKIP LOCKED 선점 구조는 유지하되 취소 요청된 PENDING 행은 선점하지 않는다.
CREATE OR REPLACE FUNCTION public.claim_next_document_generation_job(p_worker_id TEXT)
RETURNS SETOF public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_id UUID;
BEGIN
  SELECT id
  INTO selected_id
  FROM public.document_generation_jobs
  WHERE status = 'PENDING'
    AND cancel_requested_at IS NULL
  ORDER BY requested_at NULLS LAST, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF selected_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.document_generation_jobs
  SET status = 'PROCESSING',
      started_at = CURRENT_TIMESTAMP,
      worker_id = p_worker_id,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = selected_id
    AND status = 'PENDING'
    AND cancel_requested_at IS NULL
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_document_generation_job(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_document_generation_job(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
