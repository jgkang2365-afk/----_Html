BEGIN;

ALTER TABLE public.document_generation_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_lease_id UUID,
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_lease_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.document_generation_jobs.cancel_requested_at IS
  '사용자 또는 API가 문서 생성 취소를 요청한 시각';
COMMENT ON COLUMN public.document_generation_jobs.cancel_requested_by IS
  '문서 생성 취소를 요청한 사용자';
COMMENT ON COLUMN public.document_generation_jobs.cancelled_at IS
  'Worker 또는 PENDING 취소가 안전하게 종료된 시각';
COMMENT ON COLUMN public.document_generation_jobs.worker_lease_id IS
  '현재 Worker 프로세스가 Job 선점 시 발급한 고유 lease 식별자';
COMMENT ON COLUMN public.document_generation_jobs.worker_heartbeat_at IS
  '현재 Worker 프로세스가 lease를 마지막으로 갱신한 시각';
COMMENT ON COLUMN public.document_generation_jobs.worker_lease_expires_at IS
  'heartbeat가 없을 때 Worker 소유권이 만료되는 DB 기준 시각';

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

-- migration과 애플리케이션 배포 사이에는 lease 없는 구버전 Worker의 신규 선점을 막는다.
CREATE OR REPLACE FUNCTION public.claim_next_document_generation_job(p_worker_id TEXT)
RETURNS SETOF public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;

-- 기존 SKIP LOCKED 선점 구조를 유지하면서 프로세스별 lease를 원자적으로 설정한다.
CREATE OR REPLACE FUNCTION public.claim_next_document_generation_job(
  p_worker_id TEXT,
  p_worker_lease_id UUID
)
RETURNS SETOF public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' OR p_worker_lease_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.document_generation_jobs job
  SET status = 'PROCESSING',
      started_at = CURRENT_TIMESTAMP,
      worker_id = p_worker_id,
      worker_lease_id = p_worker_lease_id,
      worker_heartbeat_at = CURRENT_TIMESTAMP,
      worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '90 seconds',
      updated_at = CURRENT_TIMESTAMP
  WHERE job.id = (
    SELECT candidate.id
    FROM public.document_generation_jobs candidate
    WHERE candidate.status = 'PENDING'
      AND candidate.cancel_requested_at IS NULL
    ORDER BY candidate.requested_at NULLS LAST, candidate.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
    AND job.status = 'PENDING'
    AND job.cancel_requested_at IS NULL
  RETURNING job.*;
END;
$$;

-- heartbeat와 게시 완료 checkpoint는 동일 lease 조건으로만 갱신한다.
CREATE OR REPLACE FUNCTION public.renew_document_generation_job_lease(
  p_job_id UUID,
  p_worker_id TEXT,
  p_worker_lease_id UUID,
  p_result_files JSONB DEFAULT NULL
)
RETURNS TABLE(
  status TEXT,
  cancel_requested BOOLEAN,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.document_generation_jobs job
  SET worker_heartbeat_at = CURRENT_TIMESTAMP,
      worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '90 seconds',
      result_files = COALESCE(p_result_files, job.result_files),
      updated_at = CURRENT_TIMESTAMP
  WHERE job.id = p_job_id
    AND job.status = 'PROCESSING'
    AND job.worker_id = p_worker_id
    AND job.worker_lease_id = p_worker_lease_id
  RETURNING
    job.status,
    job.cancel_requested_at IS NOT NULL,
    job.worker_lease_expires_at;
END;
$$;

-- 시간만으로 취소하지 않는다. 취소 요청과 확인 가능한 lease 만료가 모두 필요하다.
CREATE OR REPLACE FUNCTION public.recover_cancelled_document_generation_jobs()
RETURNS SETOF public.document_generation_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.document_generation_jobs job
  SET status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM jsonb_array_elements(job.result_files) result
          WHERE result->>'status' = 'COMPLETED'
        ) THEN 'PARTIAL_SUCCESS'
        ELSE 'CANCELLED'
      END,
      cancelled_at = CURRENT_TIMESTAMP,
      completed_at = CURRENT_TIMESTAMP,
      error_message = COALESCE(
        job.error_message,
        '취소 요청 후 Worker lease 만료로 작업을 종결했습니다.'
      ),
      updated_at = CURRENT_TIMESTAMP
  WHERE job.status = 'PROCESSING'
    AND job.cancel_requested_at IS NOT NULL
    AND job.worker_lease_id IS NOT NULL
    AND job.worker_lease_expires_at IS NOT NULL
    AND job.worker_lease_expires_at <= CURRENT_TIMESTAMP
  RETURNING job.*;
$$;

REVOKE ALL ON FUNCTION public.claim_next_document_generation_job(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_document_generation_job(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_document_generation_job_lease(UUID, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_cancelled_document_generation_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_document_generation_job(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_document_generation_job(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_document_generation_job_lease(UUID, TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_cancelled_document_generation_jobs() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
