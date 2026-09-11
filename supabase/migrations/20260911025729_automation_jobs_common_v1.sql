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
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  ON public.automation_jobs (job_type, available_at, created_at)
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    job_id, job_type, status, progress_stage, progress_percent, result_code, updated_at, available_at
  ) VALUES (
    NEW.id, NEW.job_type, NEW.status, NEW.progress_stage, NEW.progress_percent, NEW.result_code, NEW.updated_at, NEW.available_at
  )
  ON CONFLICT (job_id) DO UPDATE SET
    status = EXCLUDED.status,
    progress_stage = EXCLUDED.progress_stage,
    progress_percent = EXCLUDED.progress_percent,
    result_code = EXCLUDED.result_code,
    updated_at = EXCLUDED.updated_at,
    available_at = EXCLUDED.available_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_jobs_signal ON public.automation_jobs;
CREATE TRIGGER trg_automation_jobs_signal
AFTER INSERT OR UPDATE OF status, progress_stage, progress_percent, result_code
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
    WHERE status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP AND job_type = ANY(p_job_types)
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

-- Recovery has three deliberately distinct paths.  Before an external effect
-- starts a job can safely return to PENDING.  Once an effect has started but
-- is not evidenced, retrying would duplicate work and requires confirmation.
-- A confirmed effect is terminalised only when its worker recorded evidence.
CREATE OR REPLACE FUNCTION public.reconcile_stale_automation_jobs(
  p_job_types TEXT[]
)
RETURNS SETOF public.automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Safe recovery: no external effect boundary was crossed.
  UPDATE public.automation_jobs
  SET status = 'PENDING', worker_id = NULL, worker_lease_expires_at = NULL,
      claimed_at = NULL, started_at = NULL,
      progress_stage = 'Worker 재연결 대기', progress_percent = 0,
      updated_at = CURRENT_TIMESTAMP
  WHERE status = 'RUNNING'
    AND job_type = ANY(p_job_types)
    AND job_type <> 'DOCUMENT_GENERATION'
    AND worker_lease_expires_at < CURRENT_TIMESTAMP
    AND effect_started_at IS NULL;

  -- Terminal acknowledgement was lost after a verified effect.  The result
  -- payload is evidence, not the timestamp alone.
  UPDATE public.automation_jobs
  SET status = 'COMPLETED', progress_stage = '확인된 효과 복구', progress_percent = 100,
      finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE status = 'RUNNING'
    AND job_type = ANY(p_job_types)
    AND job_type <> 'DOCUMENT_GENERATION'
    AND worker_lease_expires_at < CURRENT_TIMESTAMP
    AND effect_confirmed_at IS NOT NULL
    AND result_payload IS NOT NULL
    AND (
      (result_payload ? 'files' AND jsonb_array_length(coalesce(result_payload->'files', '[]'::jsonb)) > 0)
      OR result_payload @> '{"syncSuccess": true}'::jsonb
    );

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
    AND job_type <> 'DOCUMENT_GENERATION'
    AND worker_lease_expires_at < CURRENT_TIMESTAMP
    AND effect_started_at IS NOT NULL
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
  WHERE id = p_job_id AND status IN ('RUNNING', 'CANCEL_REQUESTED') AND worker_id = p_worker_id
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
  p_requested_by BIGINT DEFAULT NULL,
  p_available_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

  -- Serialise per-target external national-support work, independently of
  -- request idempotency.  Terminal jobs deliberately do not block a re-run.
  IF p_job_type = 'NATIONAL_SUPPORT' AND nullif(trim(p_target_key), '') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_target_key));
    -- The legacy queue is drain-only after this migration.  Its rows are
    -- still authoritative enough to block a conflicting new external effect.
    IF EXISTS (
      SELECT 1 FROM public.background_jobs legacy
      WHERE legacy.job_type = 'national_support'
        AND legacy.status IN ('pending','processing','cancel_requested')
        AND legacy.payload->>'target_id' = p_request_payload->>'target_id'
    ) THEN
      RAISE EXCEPTION 'NATIONAL_SUPPORT_LEGACY_JOB_ACTIVE';
    END IF;
    SELECT * INTO queued FROM public.automation_jobs
      WHERE job_type = 'NATIONAL_SUPPORT' AND target_key = p_target_key
        AND status IN ('PENDING','RUNNING','CANCEL_REQUESTED','CONFIRM_REQUIRED')
      ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN RETURN queued; END IF;
  END IF;

  -- MES is a single interactive Windows application.  A manual request and a
  -- scheduled request must therefore share one atomic execution lane even
  -- though their idempotency keys intentionally differ.
  IF p_job_type = 'MES_SYNC' THEN
    PERFORM pg_advisory_xact_lock(hashtext('automation:mes-sync'));
    SELECT * INTO queued FROM public.automation_jobs
      WHERE job_type = 'MES_SYNC'
        AND status IN ('PENDING','RUNNING','CANCEL_REQUESTED','CONFIRM_REQUIRED')
      ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN RETURN queued; END IF;
  END IF;

  INSERT INTO public.automation_jobs (
    job_type, idempotency_key, target_key, request_payload, requested_by, available_at
  ) VALUES (
    p_job_type, p_idempotency_key, nullif(trim(p_target_key), ''),
    coalesce(p_request_payload, '{}'::jsonb), p_requested_by, coalesce(p_available_at, CURRENT_TIMESTAMP)
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET updated_at = public.automation_jobs.updated_at
  RETURNING * INTO queued;
  RETURN queued;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_automation_job(TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_automation_job(TEXT, TEXT, TEXT, JSONB, BIGINT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_stale_automation_jobs(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_automation_job_lease(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_automation_job(TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_automation_job(TEXT, TEXT, TEXT, JSONB, BIGINT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_automation_jobs(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_automation_job_lease(UUID, TEXT) TO service_role;

-- A successful application and its delayed result lookup are one durable
-- transaction: no process crash can leave a completed parent without follow-up.
CREATE OR REPLACE FUNCTION public.complete_automation_job_with_followup(
  p_job_id UUID, p_worker_id TEXT, p_result_code TEXT, p_result_payload JSONB,
  p_followup_key TEXT, p_followup_payload JSONB, p_available_at TIMESTAMPTZ,
  p_target_id BIGINT, p_sync_status TEXT, p_sync_error_message TEXT DEFAULT NULL
) RETURNS public.automation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE completed public.automation_jobs;
BEGIN
  UPDATE public.automation_jobs SET status='COMPLETED', result_code=p_result_code,
    result_payload=coalesce(p_result_payload,'{}'::jsonb), progress_percent=100,
    progress_stage='결과 확인', effect_confirmed_at=CURRENT_TIMESTAMP,
    finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
  WHERE id=p_job_id AND worker_id=p_worker_id AND status='RUNNING'
  RETURNING * INTO completed;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_TERMINAL_NOT_OWNED'; END IF;
  UPDATE public.measurement_target_business
  SET sync_status = p_sync_status, sync_error_message = p_sync_error_message,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NATIONAL_SUPPORT_TARGET_NOT_FOUND'; END IF;
  INSERT INTO public.automation_jobs(job_type,idempotency_key,target_key,request_payload,available_at)
  VALUES('NATIONAL_SUPPORT',p_followup_key,completed.target_key,coalesce(p_followup_payload,'{}'::jsonb),p_available_at)
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN completed;
END $$;
REVOKE ALL ON FUNCTION public.complete_automation_job_with_followup(UUID,TEXT,TEXT,JSONB,TEXT,JSONB,TIMESTAMPTZ,BIGINT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_automation_job_with_followup(UUID,TEXT,TEXT,JSONB,TEXT,JSONB,TIMESTAMPTZ,BIGINT,TEXT,TEXT) TO service_role;

-- MES reports progress, effect boundaries, and terminal state through this
-- ownership-checked RPC.  A worker that lost its lease (or was superseded by
-- stale recovery) cannot write a late terminal result over the new owner.
CREATE OR REPLACE FUNCTION public.update_automation_job_owned(
  p_job_id UUID,
  p_worker_id TEXT,
  p_fields JSONB
) RETURNS public.automation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated public.automation_jobs;
DECLARE requested_status TEXT := nullif(p_fields->>'status', '');
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'AUTOMATION_UPDATE_ARGUMENT_INVALID';
  END IF;
  IF requested_status IS NOT NULL AND requested_status NOT IN
    ('RUNNING','COMPLETED','FAILED','CANCELLED','CONFIRM_REQUIRED') THEN
    RAISE EXCEPTION 'AUTOMATION_UPDATE_STATUS_INVALID';
  END IF;
  UPDATE public.automation_jobs job
  SET status = coalesce(requested_status, job.status),
      progress_stage = CASE WHEN p_fields ? 'progress_stage' THEN p_fields->>'progress_stage' ELSE job.progress_stage END,
      progress_percent = CASE WHEN p_fields ? 'progress_percent' THEN (p_fields->>'progress_percent')::SMALLINT ELSE job.progress_percent END,
      result_code = CASE WHEN p_fields ? 'result_code' THEN p_fields->>'result_code' ELSE job.result_code END,
      result_payload = CASE WHEN p_fields ? 'result_payload' THEN p_fields->'result_payload' ELSE job.result_payload END,
      error_code = CASE WHEN p_fields ? 'error_code' THEN p_fields->>'error_code' ELSE job.error_code END,
      error_message = CASE WHEN p_fields ? 'error_message' THEN p_fields->>'error_message' ELSE job.error_message END,
      effect_started_at = CASE WHEN p_fields ? 'effect_started_at' THEN coalesce(job.effect_started_at, (p_fields->>'effect_started_at')::TIMESTAMPTZ) ELSE job.effect_started_at END,
      effect_confirmed_at = CASE WHEN p_fields ? 'effect_confirmed_at' THEN coalesce(job.effect_confirmed_at, (p_fields->>'effect_confirmed_at')::TIMESTAMPTZ) ELSE job.effect_confirmed_at END,
      finished_at = CASE WHEN p_fields ? 'finished_at' THEN (p_fields->>'finished_at')::TIMESTAMPTZ ELSE job.finished_at END,
      updated_at = CURRENT_TIMESTAMP
  WHERE job.id = p_job_id
    AND job.worker_id = p_worker_id
    AND job.status IN ('RUNNING','CANCEL_REQUESTED')
  RETURNING job.* INTO updated;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_UPDATE_NOT_OWNED'; END IF;
  RETURN updated;
END;
$$;
REVOKE ALL ON FUNCTION public.update_automation_job_owned(UUID,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_automation_job_owned(UUID,TEXT,JSONB) TO service_role;

-- Document execution has two records for compatibility, but one ownership
-- boundary.  Reconciliation is deliberately separate from the generic job
-- reconciler so a common pre-effect retry never leaves legacy PROCESSING.
CREATE OR REPLACE FUNCTION public.reconcile_stale_document_automation_jobs()
RETURNS SETOF public.automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.document_generation_jobs legacy
  SET status = 'PENDING', worker_id = NULL, worker_lease_id = NULL,
      worker_heartbeat_at = NULL, worker_lease_expires_at = NULL,
      started_at = NULL, updated_at = CURRENT_TIMESTAMP
  FROM public.automation_jobs common
  WHERE common.job_type = 'DOCUMENT_GENERATION'
    AND common.status = 'RUNNING'
    AND common.worker_lease_expires_at < CURRENT_TIMESTAMP
    AND common.effect_started_at IS NULL
    AND common.request_payload->>'document_generation_job_id' = legacy.id::text
    AND legacy.status = 'PROCESSING';

  UPDATE public.automation_jobs common
  SET status = 'PENDING', worker_id = NULL, worker_lease_expires_at = NULL,
      claimed_at = NULL, started_at = NULL,
      progress_stage = 'Worker 재연결 대기', progress_percent = 0,
      updated_at = CURRENT_TIMESTAMP
  WHERE common.job_type = 'DOCUMENT_GENERATION'
    AND common.status = 'RUNNING'
    AND common.worker_lease_expires_at < CURRENT_TIMESTAMP
    AND common.effect_started_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.document_generation_jobs legacy
      WHERE legacy.id::text = common.request_payload->>'document_generation_job_id'
        AND legacy.status = 'PENDING'
    );

  -- An evidence-confirmed publish is terminalised without replaying it.
  UPDATE public.document_generation_jobs legacy
  SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  FROM public.automation_jobs common
  WHERE common.job_type = 'DOCUMENT_GENERATION'
    AND common.status = 'RUNNING'
    AND common.worker_lease_expires_at < CURRENT_TIMESTAMP
    AND common.effect_confirmed_at IS NOT NULL
    AND common.result_payload ? 'files'
    AND jsonb_array_length(coalesce(common.result_payload->'files','[]'::jsonb)) > 0
    AND common.request_payload->>'document_generation_job_id' = legacy.id::text
    AND legacy.status = 'PROCESSING';

  UPDATE public.automation_jobs common
  SET status = 'COMPLETED', progress_stage = '확인된 파일 효과 복구', progress_percent = 100,
      finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE common.job_type = 'DOCUMENT_GENERATION'
    AND common.status = 'RUNNING'
    AND common.worker_lease_expires_at < CURRENT_TIMESTAMP
    AND common.effect_confirmed_at IS NOT NULL
    AND common.result_payload ? 'files'
    AND jsonb_array_length(coalesce(common.result_payload->'files','[]'::jsonb)) > 0;

  UPDATE public.document_generation_jobs legacy
  SET status = 'PARTIAL_SUCCESS', completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  FROM public.automation_jobs common
  WHERE common.job_type = 'DOCUMENT_GENERATION'
    AND common.status = 'RUNNING'
    AND common.worker_lease_expires_at < CURRENT_TIMESTAMP
    AND common.effect_started_at IS NOT NULL
    AND common.effect_confirmed_at IS NULL
    AND common.request_payload->>'document_generation_job_id' = legacy.id::text
    AND legacy.status = 'PROCESSING';

  RETURN QUERY
  UPDATE public.automation_jobs common
  SET status = 'CONFIRM_REQUIRED', progress_stage = 'Worker 종료 후 파일 효과 확인 필요',
      progress_percent = 100, result_code = 'DOCUMENT_EFFECT_UNCERTAIN',
      error_code = 'DOCUMENT_WORKER_LEASE_EXPIRED',
      error_message = '최종 파일 게시 뒤 Worker 연결이 끊겨 자동 재실행하지 않았습니다.',
      finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE common.job_type = 'DOCUMENT_GENERATION'
    AND common.status = 'RUNNING'
    AND common.worker_lease_expires_at < CURRENT_TIMESTAMP
    AND common.effect_started_at IS NOT NULL
    AND common.effect_confirmed_at IS NULL
  RETURNING common.*;
END;
$$;

-- Legacy and common terminal rows are written atomically and both require the
-- same worker/lease ownership.  A late stale worker cannot overwrite a newer
-- claim, and an ACK failure rolls the compatibility row back as well.
CREATE OR REPLACE FUNCTION public.complete_document_automation_job(
  p_legacy_job_id UUID, p_automation_job_id UUID, p_worker_id TEXT,
  p_worker_lease_id UUID, p_legacy_status TEXT, p_result_files JSONB,
  p_error_message TEXT, p_effect_uncertain BOOLEAN DEFAULT FALSE
) RETURNS public.document_generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE completed public.document_generation_jobs;
DECLARE common_status TEXT;
DECLARE safe_complete BOOLEAN;
BEGIN
  safe_complete := p_legacy_status = 'COMPLETED'
    AND jsonb_array_length(coalesce(p_result_files, '[]'::jsonb)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_result_files, '[]'::jsonb)) file
      WHERE coalesce(file->>'status','') <> 'COMPLETED'
    );
  common_status := CASE
    WHEN p_effect_uncertain THEN 'CONFIRM_REQUIRED'
    WHEN safe_complete THEN 'COMPLETED'
    WHEN jsonb_array_length(coalesce(p_result_files, '[]'::jsonb)) > 0 THEN 'CONFIRM_REQUIRED'
    WHEN p_legacy_status = 'CANCELLED' THEN 'CANCELLED'
    ELSE 'FAILED'
  END;

  UPDATE public.document_generation_jobs
  SET status = p_legacy_status, result_files = coalesce(p_result_files, '[]'::jsonb),
      error_message = nullif(left(coalesce(p_error_message, ''), 4000), ''),
      completed_at = CURRENT_TIMESTAMP,
      cancelled_at = CASE WHEN p_legacy_status = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_legacy_job_id AND status = 'PROCESSING'
    AND worker_id = p_worker_id AND worker_lease_id = p_worker_lease_id
  RETURNING * INTO completed;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_LEGACY_TERMINAL_NOT_OWNED'; END IF;

  UPDATE public.automation_jobs
  SET status = common_status,
      progress_stage = CASE WHEN safe_complete THEN '파일 확인 완료'
        WHEN common_status = 'CONFIRM_REQUIRED' THEN '효과 확인 필요' ELSE '문서 생성 종료' END,
      progress_percent = 100,
      result_code = CASE WHEN safe_complete THEN 'DOCUMENT_FILES_CONFIRMED'
        WHEN common_status = 'CONFIRM_REQUIRED' THEN 'DOCUMENT_EFFECT_UNCERTAIN' ELSE NULL END,
      result_payload = jsonb_build_object('files', coalesce(p_result_files, '[]'::jsonb)),
      error_code = CASE WHEN common_status = 'CONFIRM_REQUIRED' THEN 'DOCUMENT_PARTIAL_OR_UNCERTAIN' ELSE NULL END,
      error_message = CASE WHEN common_status = 'CONFIRM_REQUIRED'
        THEN '파일 publish 효과가 불확실하여 자동 재실행하지 않았습니다.'
        ELSE nullif(left(coalesce(p_error_message, ''), 4000), '') END,
      effect_confirmed_at = CASE WHEN safe_complete THEN CURRENT_TIMESTAMP ELSE effect_confirmed_at END,
      finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = p_automation_job_id
    AND job_type = 'DOCUMENT_GENERATION'
    AND worker_id = p_worker_id
    AND status IN ('RUNNING', 'CANCEL_REQUESTED')
    AND request_payload->>'document_generation_job_id' = p_legacy_job_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_AUTOMATION_TERMINAL_NOT_OWNED'; END IF;
  RETURN completed;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_document_automation_effect_started(
  p_legacy_job_id UUID, p_automation_job_id UUID, p_worker_id TEXT, p_worker_lease_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.document_generation_jobs
  WHERE id = p_legacy_job_id AND status = 'PROCESSING'
    AND worker_id = p_worker_id AND worker_lease_id = p_worker_lease_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_LEGACY_EFFECT_NOT_OWNED'; END IF;
  UPDATE public.automation_jobs
  SET effect_started_at = coalesce(effect_started_at, CURRENT_TIMESTAMP),
      progress_stage = '최종 파일 게시', progress_percent = 70, updated_at = CURRENT_TIMESTAMP
  WHERE id = p_automation_job_id AND job_type = 'DOCUMENT_GENERATION'
    AND status = 'RUNNING' AND worker_id = p_worker_id
    AND request_payload->>'document_generation_job_id' = p_legacy_job_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_AUTOMATION_EFFECT_NOT_OWNED'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_stale_document_automation_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_document_automation_job(UUID,UUID,TEXT,UUID,TEXT,JSONB,TEXT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_document_automation_effect_started(UUID,UUID,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_document_automation_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_document_automation_job(UUID,UUID,TEXT,UUID,TEXT,JSONB,TEXT,BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_document_automation_effect_started(UUID,UUID,TEXT,UUID) TO service_role;

-- Heartbeats and cancellation recovery advance both document representations
-- in one transaction. A failed common lease renewal therefore cannot leave a
-- healthy legacy lease beside an expired common owner.
CREATE OR REPLACE FUNCTION public.renew_document_automation_job_lease(
  p_legacy_job_id UUID, p_automation_job_id UUID, p_worker_id TEXT,
  p_worker_lease_id UUID, p_result_files JSONB DEFAULT NULL
) RETURNS TABLE(status TEXT, cancel_requested BOOLEAN, lease_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH legacy AS (
    UPDATE public.document_generation_jobs job
    SET worker_heartbeat_at = CURRENT_TIMESTAMP,
        worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '90 seconds',
        result_files = coalesce(p_result_files, job.result_files), updated_at = CURRENT_TIMESTAMP
    WHERE job.id = p_legacy_job_id AND job.status = 'PROCESSING'
      AND job.worker_id = p_worker_id AND job.worker_lease_id = p_worker_lease_id
    RETURNING job.status, job.cancel_requested_at, job.worker_lease_expires_at
  ), common AS (
    UPDATE public.automation_jobs job
    SET worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes', updated_at = CURRENT_TIMESTAMP
    WHERE job.id = p_automation_job_id AND job.job_type = 'DOCUMENT_GENERATION'
      AND job.worker_id = p_worker_id AND job.status IN ('RUNNING', 'CANCEL_REQUESTED')
      AND EXISTS (SELECT 1 FROM legacy)
    RETURNING job.id
  )
  SELECT legacy.status, legacy.cancel_requested_at IS NOT NULL, legacy.worker_lease_expires_at
  FROM legacy WHERE EXISTS (SELECT 1 FROM common);
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_cancelled_document_generation_jobs()
RETURNS SETOF public.document_generation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH recovered AS (
    UPDATE public.document_generation_jobs job
    SET status = CASE WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(job.result_files, '[]'::jsonb)) result
          WHERE result->>'status' = 'COMPLETED'
        ) THEN 'PARTIAL_SUCCESS' ELSE 'CANCELLED' END,
        cancelled_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP,
        error_message = coalesce(job.error_message, '취소 요청 후 Worker lease 만료로 작업을 종결했습니다.'),
        updated_at = CURRENT_TIMESTAMP
    WHERE job.status = 'PROCESSING' AND job.cancel_requested_at IS NOT NULL
      AND job.worker_lease_id IS NOT NULL AND job.worker_lease_expires_at <= CURRENT_TIMESTAMP
    RETURNING job.*
  ), common AS (
    UPDATE public.automation_jobs job
    SET status = CASE WHEN job.effect_started_at IS NOT NULL AND job.effect_confirmed_at IS NULL
          THEN 'CONFIRM_REQUIRED' ELSE 'CANCELLED' END,
        progress_stage = CASE WHEN job.effect_started_at IS NOT NULL AND job.effect_confirmed_at IS NULL
          THEN '취소 후 파일 효과 확인 필요' ELSE '취소됨' END,
        progress_percent = 100, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    FROM recovered legacy
    WHERE job.job_type = 'DOCUMENT_GENERATION'
      AND job.request_payload->>'document_generation_job_id' = legacy.id::text
      AND job.status IN ('RUNNING', 'CANCEL_REQUESTED')
    RETURNING job.id
  )
  SELECT recovered.* FROM recovered;
END;
$$;
REVOKE ALL ON FUNCTION public.renew_document_automation_job_lease(UUID,UUID,TEXT,UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_cancelled_document_generation_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_document_automation_job_lease(UUID,UUID,TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_cancelled_document_generation_jobs() TO service_role;

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

-- A terminal legacy row alone is not permission to replay a document.  When
-- the common record is CONFIRM_REQUIRED a prior publish may already exist;
-- reject a new legacy request at the database boundary before its AFTER
-- trigger can create another common job.
CREATE OR REPLACE FUNCTION public.guard_document_automation_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'PENDING' THEN
    PERFORM pg_advisory_xact_lock(hashtext('document:' || NEW.business_id::text));
    IF EXISTS (
      SELECT 1 FROM public.automation_jobs common
      WHERE common.job_type = 'DOCUMENT_GENERATION'
        AND common.target_key = 'document:' || NEW.business_id::text
        AND common.status IN ('PENDING','RUNNING','CANCEL_REQUESTED','CONFIRM_REQUIRED')
    ) THEN
      RAISE EXCEPTION 'DOCUMENT_AUTOMATION_ACTIVE_OR_CONFIRM_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_generation_automation_job ON public.document_generation_jobs;
DROP TRIGGER IF EXISTS trg_document_generation_automation_guard ON public.document_generation_jobs;
CREATE TRIGGER trg_document_generation_automation_guard
BEFORE INSERT ON public.document_generation_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_document_automation_enqueue();
CREATE TRIGGER trg_document_generation_automation_job
AFTER INSERT ON public.document_generation_jobs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_document_automation_job();
REVOKE ALL ON FUNCTION public.enqueue_document_automation_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_document_automation_enqueue() FROM PUBLIC;

-- Forward-compatible cutover: only legacy PENDING rows receive a common
-- ownership record.  Processing/terminal history is never replayed.
INSERT INTO public.automation_jobs (job_type, idempotency_key, target_key, request_payload, requested_by)
SELECT 'DOCUMENT_GENERATION', 'document:legacy:' || legacy.id::text,
       'document:' || legacy.business_id::text,
       jsonb_build_object('document_generation_job_id', legacy.id, 'business_id', legacy.business_id),
       legacy.requested_by
FROM public.document_generation_jobs legacy
WHERE legacy.status = 'PENDING'
ON CONFLICT (idempotency_key) DO NOTHING;

-- The legacy claim RPC is intentionally disabled after the common trigger is
-- installed.  DOCUMENT_GENERATION ownership must pass through
-- claim_next_automation_job; an old worker therefore cannot race the common
-- worker for the same legacy row.
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
  RETURN;
END;
$$;

-- Protect the reverse direction too: old code may still insert pre-existing
-- legacy national-support work while it drains.  It shares the same advisory
-- key as the new enqueue RPC, so a legacy INSERT cannot race a new common
-- NATIONAL_SUPPORT job for one target.
CREATE OR REPLACE FUNCTION public.guard_legacy_national_support_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.job_type = 'national_support' THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_LEGACY_DRAIN_ONLY';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.job_type = 'national_support'
     AND OLD.status IN ('success','failed','cancelled') AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_LEGACY_REQUEUE_FORBIDDEN';
  END IF;
  IF NEW.job_type <> 'national_support' THEN RETURN NEW; END IF;
  target_id := nullif(NEW.payload->>'target_id', '');
  IF target_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('national-support:' || target_id));
  IF EXISTS (
    SELECT 1 FROM public.automation_jobs common
    WHERE common.job_type = 'NATIONAL_SUPPORT'
      AND common.target_key = 'national-support:' || target_id
      AND common.status IN ('PENDING','RUNNING','CANCEL_REQUESTED','CONFIRM_REQUIRED')
  ) THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_AUTOMATION_JOB_ACTIVE';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_background_jobs_national_support_cutover ON public.background_jobs;
CREATE TRIGGER trg_background_jobs_national_support_cutover
BEFORE INSERT OR UPDATE OF status ON public.background_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_national_support_enqueue();
REVOKE ALL ON FUNCTION public.guard_legacy_national_support_enqueue() FROM PUBLIC;

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
