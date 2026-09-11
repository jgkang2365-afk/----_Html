-- Local automation v1: one durable execution contract for the Windows workers.
-- request_payload/result_payload are intentionally kept out of Realtime; clients
-- subscribe to automation_job_signals and obtain authorised details through APIs.

CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'CONFIRM_REQUIRED')),
  idempotency_key TEXT NOT NULL,
  target_key TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress_stage TEXT,
  progress_percent SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  result_code TEXT,
  result_payload JSONB,
  error_code TEXT,
  error_message TEXT,
  worker_id TEXT,
  worker_lease_expires_at TIMESTAMPTZ,
  requested_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancel_requested_at TIMESTAMPTZ,
  effect_started_at TIMESTAMPTZ,
  effect_confirmed_at TIMESTAMPTZ,
  CONSTRAINT automation_jobs_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS automation_jobs_pending_claim_idx
  ON public.automation_jobs (job_type, created_at)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS automation_jobs_target_idx
  ON public.automation_jobs (target_key, created_at DESC);
CREATE INDEX IF NOT EXISTS automation_jobs_running_lease_idx
  ON public.automation_jobs (worker_lease_expires_at)
  WHERE status = 'RUNNING';

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_jobs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.automation_job_signals (
  job_id UUID PRIMARY KEY REFERENCES public.automation_jobs(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_stage TEXT,
  progress_percent SMALLINT NOT NULL DEFAULT 0,
  result_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.automation_job_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_job_signals_realtime_read ON public.automation_job_signals;
CREATE POLICY automation_job_signals_realtime_read
  ON public.automation_job_signals FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.automation_job_signals TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_automation_job_signal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.automation_job_signals (
    job_id, job_type, status, progress_stage, progress_percent, result_code, updated_at
  ) VALUES (
    NEW.id, NEW.job_type, NEW.status, NEW.progress_stage, NEW.progress_percent, NEW.result_code, NEW.updated_at
  )
  ON CONFLICT (job_id) DO UPDATE SET
    status = EXCLUDED.status,
    progress_stage = EXCLUDED.progress_stage,
    progress_percent = EXCLUDED.progress_percent,
    result_code = EXCLUDED.result_code,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_jobs_signal ON public.automation_jobs;
CREATE TRIGGER trg_automation_jobs_signal
AFTER INSERT OR UPDATE OF status, progress_stage, progress_percent, result_code, updated_at
ON public.automation_jobs
FOR EACH ROW EXECUTE FUNCTION public.sync_automation_job_signal();

CREATE OR REPLACE FUNCTION public.claim_next_automation_job(
  p_worker_id TEXT,
  p_job_types TEXT[]
)
RETURNS SETOF public.automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.automation_jobs;
BEGIN
  IF coalesce(trim(p_worker_id), '') = '' OR coalesce(array_length(p_job_types, 1), 0) = 0 THEN
    RAISE EXCEPTION 'AUTOMATION_CLAIM_ARGUMENT_INVALID';
  END IF;

  WITH next_job AS (
    SELECT id
    FROM public.automation_jobs
    WHERE status = 'PENDING' AND job_type = ANY(p_job_types)
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.automation_jobs job
  SET status = 'RUNNING', worker_id = p_worker_id,
      claimed_at = CURRENT_TIMESTAMP, started_at = CURRENT_TIMESTAMP,
      worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes',
      updated_at = CURRENT_TIMESTAMP
  FROM next_job
  WHERE job.id = next_job.id
  RETURNING job.* INTO claimed;

  IF FOUND THEN
    RETURN NEXT claimed;
  END IF;
  RETURN;
END;
$$;

-- Reconnect recovery is deliberately conservative: a stale RUNNING job is
-- never re-run because an external GUI effect may already have happened.
CREATE OR REPLACE FUNCTION public.reconcile_stale_automation_jobs(
  p_job_types TEXT[]
)
RETURNS SETOF public.automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.automation_jobs
  SET status = 'CONFIRM_REQUIRED',
      progress_stage = 'Worker 종료 후 효과 확인 필요',
      progress_percent = 100,
      result_code = 'WORKER_INTERRUPTED',
      error_code = 'WORKER_LEASE_EXPIRED',
      error_message = '실행 중 Worker 연결이 복구되지 않아 자동 재실행하지 않았습니다.',
      finished_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE status = 'RUNNING'
    AND job_type = ANY(p_job_types)
    AND worker_lease_expires_at < CURRENT_TIMESTAMP
  RETURNING public.automation_jobs.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_automation_job_lease(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS public.automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE renewed public.automation_jobs;
BEGIN
  UPDATE public.automation_jobs
  SET worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_job_id AND status = 'RUNNING' AND worker_id = p_worker_id
  RETURNING * INTO renewed;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_LEASE_NOT_OWNED'; END IF;
  RETURN renewed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_automation_job(
  p_job_type TEXT,
  p_idempotency_key TEXT,
  p_target_key TEXT,
  p_request_payload JSONB DEFAULT '{}'::jsonb,
  p_requested_by BIGINT DEFAULT NULL
)
RETURNS public.automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued public.automation_jobs;
BEGIN
  IF coalesce(trim(p_job_type), '') = '' OR coalesce(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'AUTOMATION_ENQUEUE_ARGUMENT_INVALID';
  END IF;

  INSERT INTO public.automation_jobs (
    job_type, idempotency_key, target_key, request_payload, requested_by
  ) VALUES (
    p_job_type, p_idempotency_key, nullif(trim(p_target_key), ''),
    coalesce(p_request_payload, '{}'::jsonb), p_requested_by
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET updated_at = public.automation_jobs.updated_at
  RETURNING * INTO queued;
  RETURN queued;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_automation_job(TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_automation_job(TEXT, TEXT, TEXT, JSONB, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_stale_automation_jobs(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_automation_job_lease(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_automation_job(TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_automation_job(TEXT, TEXT, TEXT, JSONB, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_automation_jobs(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_automation_job_lease(UUID, TEXT) TO service_role;

-- The legacy document row remains the authoritative document payload, but its
-- common execution record is created in the same transaction. This prevents a
-- wake-up from observing a legacy job without its automation contract.
CREATE OR REPLACE FUNCTION public.enqueue_document_automation_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'PENDING' THEN
    INSERT INTO public.automation_jobs (
      job_type, idempotency_key, target_key, request_payload, requested_by
    ) VALUES (
      'DOCUMENT_GENERATION',
      'document:legacy:' || NEW.id::text,
      'document:' || NEW.business_id::text,
      jsonb_build_object('document_generation_job_id', NEW.id, 'business_id', NEW.business_id),
      NEW.requested_by
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_generation_automation_job ON public.document_generation_jobs;
CREATE TRIGGER trg_document_generation_automation_job
AFTER INSERT ON public.document_generation_jobs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_document_automation_job();
REVOKE ALL ON FUNCTION public.enqueue_document_automation_job() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'automation_job_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_job_signals;
  END IF;
END;
$$;
