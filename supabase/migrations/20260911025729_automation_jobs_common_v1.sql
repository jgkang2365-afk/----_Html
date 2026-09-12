-- Local automation v1: one durable execution contract for the Windows workers.
-- request_payload/result_payload are intentionally kept out of Realtime; clients
-- subscribe to automation_job_signals and obtain authorised details through APIs.

-- Cutover preflight: processing work without an explicit pre-effect marker is
-- quarantined by aborting this migration. It must be reviewed before cutover.
DO $$
DECLARE health_uncertain INTEGER;
DECLARE document_uncertain INTEGER;
DECLARE active_legacy INTEGER;
BEGIN
  SELECT (SELECT count(*) FROM public.background_jobs WHERE job_type='national_support'
    AND status IN ('pending','processing','cancel_requested'))
    + (SELECT count(*) FROM public.document_generation_jobs WHERE status IN ('PENDING','PROCESSING'))
    INTO active_legacy;
  IF active_legacy > 0 AND current_setting('app.automation_legacy_workers_stopped', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'AUTOMATION_CUTOVER_REQUIRES_STOPPED_LEGACY_WORKERS: active=%', active_legacy;
  END IF;
  SELECT count(*) INTO health_uncertain FROM public.background_jobs
  WHERE job_type = 'national_support' AND status IN ('processing','cancel_requested')
    AND execution_result->>'effect_started' IS DISTINCT FROM 'false';
  SELECT count(*) INTO document_uncertain FROM public.document_generation_jobs
  WHERE status = 'PROCESSING';
  IF health_uncertain > 0 OR document_uncertain > 0 THEN
    RAISE EXCEPTION 'AUTOMATION_CUTOVER_UNCERTAIN: health=%, document=%', health_uncertain, document_uncertain;
  END IF;
  UPDATE public.background_jobs SET status='cancelled', finished_at=CURRENT_TIMESTAMP,
    error_message='공통 자동화 전환: 효과 전 안전 취소', updated_at=CURRENT_TIMESTAMP
  WHERE job_type='national_support' AND
    (status='pending' OR (status IN ('processing','cancel_requested')
      AND execution_result->>'effect_started'='false'));
  UPDATE public.document_generation_jobs SET status='CANCELLED',
    cancelled_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP,
    error_message='공통 자동화 전환: 대기 작업 안전 취소', updated_at=CURRENT_TIMESTAMP
  WHERE status='PENDING';
END $$;

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

  -- Serialize competing MES claimers, including separate worker processes.
  IF 'MES_SYNC' = ANY(p_job_types) THEN
    PERFORM pg_advisory_xact_lock(hashtext('automation:mes-sync'));
  END IF;

  WITH next_job AS (
    SELECT id
    FROM public.automation_jobs
    WHERE status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP AND job_type = ANY(p_job_types)
      AND (job_type <> 'MES_SYNC' OR NOT EXISTS (
        SELECT 1 FROM public.automation_jobs active
        WHERE active.job_type = 'MES_SYNC'
          AND active.status IN ('RUNNING', 'CANCEL_REQUESTED', 'CONFIRM_REQUIRED')
      ))
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

-- Claim the common and legacy Document rows under one transaction. The
-- cancel RPC locks the same rows in the same order, preventing observable
-- RUNNING/PENDING or PENDING/PROCESSING intermediate states.
CREATE OR REPLACE FUNCTION public.claim_next_document_automation_job(
  p_worker_id TEXT,
  p_worker_lease_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  common public.automation_jobs;
  legacy public.document_generation_jobs;
BEGIN
  IF coalesce(trim(p_worker_id), '') = '' OR p_worker_lease_id IS NULL THEN
    RAISE EXCEPTION 'DOCUMENT_CLAIM_ARGUMENT_INVALID';
  END IF;

  SELECT * INTO common
  FROM public.automation_jobs
  WHERE job_type = 'DOCUMENT_GENERATION'
    AND status = 'PENDING'
    AND available_at <= CURRENT_TIMESTAMP
  ORDER BY created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO legacy
  FROM public.document_generation_jobs
  WHERE id = (common.request_payload->>'document_generation_job_id')::uuid
  FOR UPDATE;
  IF NOT FOUND OR legacy.status <> 'PENDING' THEN
    RETURN NULL;
  END IF;

  UPDATE public.automation_jobs
  SET status = 'RUNNING', worker_id = p_worker_id,
      claimed_at = CURRENT_TIMESTAMP, started_at = CURRENT_TIMESTAMP,
      worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '90 seconds',
      progress_stage = '문서 생성', progress_percent = 25,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = common.id;

  UPDATE public.document_generation_jobs
  SET status = 'PROCESSING', worker_id = p_worker_id,
      worker_lease_id = p_worker_lease_id,
      worker_heartbeat_at = CURRENT_TIMESTAMP,
      worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '90 seconds',
      started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = legacy.id;

  SELECT * INTO legacy FROM public.document_generation_jobs
  WHERE id = (common.request_payload->>'document_generation_job_id')::uuid;
  RETURN to_jsonb(legacy) || jsonb_build_object('automation_job_id', common.id);
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
  -- A cancelled MES run with no effect is terminal, never requeued.
  UPDATE public.automation_jobs
  SET status = 'CANCELLED', progress_stage = '실행 전 취소됨', progress_percent = 100,
      finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE status = 'CANCEL_REQUESTED' AND job_type = 'MES_SYNC'
    AND job_type = ANY(p_job_types) AND worker_lease_expires_at < CURRENT_TIMESTAMP
    AND effect_started_at IS NULL;

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
  WHERE status IN ('RUNNING', 'CANCEL_REQUESTED')
    AND job_type = ANY(p_job_types)
    AND job_type <> 'DOCUMENT_GENERATION'
    AND worker_lease_expires_at < CURRENT_TIMESTAMP
    AND effect_confirmed_at IS NOT NULL
    AND result_payload IS NOT NULL
    AND (
      (job_type = 'MES_SYNC' AND result_payload @> '{"syncSuccess": true}'::jsonb)
      OR (job_type <> 'MES_SYNC' AND result_payload ? 'files'
          AND jsonb_array_length(coalesce(result_payload->'files', '[]'::jsonb)) > 0)
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
  WHERE status IN ('RUNNING', 'CANCEL_REQUESTED')
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

  -- Scheduled slots are durable intents even while another MES run owns the
  -- physical lane. Manual requests continue to reuse an active run.
  IF p_job_type = 'MES_SYNC' THEN
    PERFORM pg_advisory_xact_lock(hashtext('automation:mes-sync'));
    IF p_request_payload->>'trigger' IS DISTINCT FROM 'scheduled' THEN
      SELECT * INTO queued FROM public.automation_jobs
        WHERE job_type = 'MES_SYNC'
          AND status IN ('PENDING','RUNNING','CANCEL_REQUESTED','CONFIRM_REQUIRED')
        ORDER BY created_at DESC LIMIT 1;
      IF FOUND THEN RETURN queued; END IF;
    END IF;
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
REVOKE ALL ON FUNCTION public.claim_next_document_automation_job(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_automation_job(TEXT, TEXT, TEXT, JSONB, BIGINT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_stale_automation_jobs(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_automation_job_lease(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_automation_job(TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_document_automation_job(TEXT, UUID) TO service_role;
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
  WHERE id=p_job_id AND job_type='NATIONAL_SUPPORT' AND worker_id=p_worker_id AND status='RUNNING'
    AND request_payload->>'target_id'=p_target_id::text
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

-- Non-follow-up Health terminal and compatibility projection share one
-- ownership-bound transaction.  A missing target or stale owner rolls both
-- updates back, rather than leaving a terminal job with an old UI status.
CREATE OR REPLACE FUNCTION public.complete_national_support_automation_job(
  p_job_id UUID, p_worker_id TEXT, p_status TEXT, p_result_code TEXT,
  p_result_payload JSONB, p_error_code TEXT, p_error_message TEXT,
  p_target_id BIGINT, p_sync_status TEXT, p_sync_error_message TEXT,
  p_effect_confirmed BOOLEAN DEFAULT FALSE
) RETURNS public.automation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE completed public.automation_jobs;
DECLARE final_support_status TEXT;
DECLARE final_application_status TEXT;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('COMPLETED','FAILED','CONFIRM_REQUIRED') OR
     p_sync_status IS NULL OR p_sync_status NOT IN ('성공','일지 등록 · 제외','조회대기','비대상대기','확인대기','신청완료대기','수동확인필요','실패') THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_TERMINAL_ARGUMENT_INVALID';
  END IF;
  final_support_status := CASE p_result_code WHEN 'SUPPORT' THEN '대상'
    WHEN 'NON_SUPPORT' THEN '비대상' ELSE NULL END;
  final_application_status := CASE p_result_code WHEN 'SUPPORT' THEN '○'
    WHEN 'NON_SUPPORT' THEN '신청취소' ELSE NULL END;
  IF final_support_status IS NOT NULL AND (p_status <> 'COMPLETED' OR p_sync_status <> '성공') THEN
    RAISE EXCEPTION 'NATIONAL_SUPPORT_FINAL_STATUS_INVALID';
  END IF;
  UPDATE public.automation_jobs job SET status=p_status,
    result_code=p_result_code, result_payload=p_result_payload,
    error_code=p_error_code, error_message=p_error_message,
    progress_stage=CASE p_status WHEN 'FAILED' THEN '조회 실패'
      WHEN 'CONFIRM_REQUIRED' THEN '외부 효과 확인 필요' ELSE '결과 확인' END,
    progress_percent=100, finished_at=CURRENT_TIMESTAMP,
    effect_confirmed_at=CASE WHEN p_effect_confirmed THEN CURRENT_TIMESTAMP ELSE job.effect_confirmed_at END,
    updated_at=CURRENT_TIMESTAMP
  WHERE job.id=p_job_id AND job.job_type='NATIONAL_SUPPORT'
    AND job.worker_id=p_worker_id AND job.status='RUNNING'
    AND job.request_payload->>'target_id'=p_target_id::text
  RETURNING job.* INTO completed;
  IF NOT FOUND THEN RAISE EXCEPTION 'NATIONAL_SUPPORT_TERMINAL_NOT_OWNED'; END IF;
  UPDATE public.measurement_target_business target
  SET sync_status=p_sync_status, sync_error_message=p_sync_error_message,
    national_support_status=coalesce(final_support_status,target.national_support_status),
    updated_at=CURRENT_TIMESTAMP
  WHERE target.id=p_target_id AND (
    final_support_status IS NULL OR (
      target.code=completed.request_payload->>'code'
      AND target.year=(completed.request_payload->>'year')::INTEGER
      AND target.period=completed.request_payload->>'period'
    ));
  IF NOT FOUND THEN RAISE EXCEPTION 'NATIONAL_SUPPORT_TARGET_NOT_FOUND'; END IF;
  IF final_support_status IS NOT NULL THEN
    INSERT INTO public.national_support_application (
      code, year, period, application_status, result, national_support_status
    ) VALUES (
      completed.request_payload->>'code', (completed.request_payload->>'year')::INTEGER,
      completed.request_payload->>'period', final_application_status,
      final_support_status, final_support_status
    ) ON CONFLICT (code, year, period) DO UPDATE SET
      application_status=EXCLUDED.application_status, result=EXCLUDED.result,
      national_support_status=EXCLUDED.national_support_status,
      updated_at=CURRENT_TIMESTAMP;
    UPDATE public.measurement_journal SET national_support_status=final_support_status
    WHERE code=completed.request_payload->>'code'
      AND measurement_year=(completed.request_payload->>'year')::INTEGER
      AND measurement_period=completed.request_payload->>'period';
  END IF;
  RETURN completed;
END $$;
REVOKE ALL ON FUNCTION public.complete_national_support_automation_job(UUID,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,BIGINT,TEXT,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_national_support_automation_job(UUID,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,BIGINT,TEXT,TEXT,BOOLEAN) TO service_role;

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

-- The upload permission and its durable marker are one row-locked decision.
CREATE OR REPLACE FUNCTION public.mark_mes_automation_effect_started(p_job_id UUID, p_worker_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.automation_jobs job
  SET effect_started_at = coalesce(job.effect_started_at, CURRENT_TIMESTAMP),
      progress_stage = 'DB 업로드 전송', progress_percent = 70, updated_at = CURRENT_TIMESTAMP
  WHERE job.id = p_job_id AND job.job_type = 'MES_SYNC'
    AND job.worker_id = p_worker_id AND job.status = 'RUNNING'
    AND job.effect_started_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_mes_automation_effect_started(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_mes_automation_effect_started(UUID,TEXT) TO service_role;

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
DECLARE renewed_legacy public.document_generation_jobs;
BEGIN
  -- Both UPDATEs must succeed or the function raises and rolls the transaction back.
  UPDATE public.document_generation_jobs job
    SET worker_heartbeat_at = CURRENT_TIMESTAMP,
        worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '90 seconds',
        result_files = coalesce(p_result_files, job.result_files), updated_at = CURRENT_TIMESTAMP
    WHERE job.id = p_legacy_job_id AND job.status = 'PROCESSING'
      AND job.worker_id = p_worker_id AND job.worker_lease_id = p_worker_lease_id
    RETURNING job.* INTO renewed_legacy;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_AUTOMATION_LEASE_NOT_OWNED'; END IF;

  UPDATE public.automation_jobs job
    SET worker_lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes', updated_at = CURRENT_TIMESTAMP
    WHERE job.id = p_automation_job_id AND job.job_type = 'DOCUMENT_GENERATION'
      AND job.worker_id = p_worker_id AND job.status IN ('RUNNING', 'CANCEL_REQUESTED')
      AND job.request_payload->>'document_generation_job_id' = p_legacy_job_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_AUTOMATION_LEASE_NOT_OWNED'; END IF;

  RETURN QUERY SELECT renewed_legacy.status, renewed_legacy.cancel_requested_at IS NOT NULL,
    renewed_legacy.worker_lease_expires_at;
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

-- Cancel crosses the common/legacy boundary in one transaction. Missing or
-- mismatched ownership rolls back rather than leaving two different states.
CREATE OR REPLACE FUNCTION public.cancel_document_automation_job(
  p_legacy_job_id UUID, p_requested_by BIGINT
) RETURNS public.document_generation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE common public.automation_jobs;
DECLARE legacy public.document_generation_jobs;
BEGIN
  SELECT * INTO common FROM public.automation_jobs
  WHERE job_type = 'DOCUMENT_GENERATION'
    AND request_payload->>'document_generation_job_id' = p_legacy_job_id::text
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_AUTOMATION_CANCEL_COMMON_MISSING'; END IF;
  SELECT * INTO legacy FROM public.document_generation_jobs WHERE id = p_legacy_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_AUTOMATION_CANCEL_LEGACY_MISSING'; END IF;
  IF common.status = 'PENDING' AND legacy.status = 'PENDING' THEN
    UPDATE public.automation_jobs SET status='CANCELLED', cancel_requested_at=CURRENT_TIMESTAMP,
      progress_stage='취소됨', progress_percent=100, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=common.id;
    UPDATE public.document_generation_jobs SET status='CANCELLED',
      cancel_requested_at=CURRENT_TIMESTAMP, cancel_requested_by=p_requested_by,
      cancelled_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=p_legacy_job_id RETURNING * INTO legacy;
  ELSIF common.status = 'RUNNING' AND legacy.status = 'PROCESSING' THEN
    UPDATE public.automation_jobs SET status='CANCEL_REQUESTED', cancel_requested_at=CURRENT_TIMESTAMP,
      progress_stage='취소 요청 전달', updated_at=CURRENT_TIMESTAMP WHERE id=common.id;
    UPDATE public.document_generation_jobs SET cancel_requested_at=CURRENT_TIMESTAMP,
      cancel_requested_by=p_requested_by, updated_at=CURRENT_TIMESTAMP
    WHERE id=p_legacy_job_id RETURNING * INTO legacy;
  ELSIF common.status IN ('CANCEL_REQUESTED','CANCELLED','COMPLETED','FAILED','CONFIRM_REQUIRED')
    AND legacy.status <> 'PENDING' THEN
    RETURN legacy;
  ELSE
    RAISE EXCEPTION 'DOCUMENT_AUTOMATION_CANCEL_STATE_MISMATCH';
  END IF;
  RETURN legacy;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_document_automation_job(UUID,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_document_automation_job(UUID,BIGINT) TO service_role;

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

-- Pre-cutover legacy pending rows were safely cancelled above. New requests
-- after this trigger is installed receive a common record atomically.

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
REVOKE ALL ON FUNCTION public.claim_next_document_generation_job(TEXT,UUID) FROM PUBLIC, anon, authenticated;

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

-- The 14:00 MES final check is a separate durable DB-only action.
-- Its terminal trigger only enqueues work; notification failures do not change MES.
CREATE OR REPLACE FUNCTION public.run_mes_final_post_sync_check(p_job_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE names TEXT[];
DECLARE message TEXT;
DECLARE parent public.automation_jobs;
BEGIN
  SELECT * INTO parent FROM public.automation_jobs WHERE id = p_job_id
    AND job_type = 'MES_SYNC' AND status = 'COMPLETED'
    AND request_payload @> '{"trigger":"scheduled","slot":"14:00","final_check":true}'::jsonb
    AND result_payload @> '{"syncSuccess":true}'::jsonb
    AND request_payload->>'scheduled_date_kst' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  IF NOT FOUND THEN RAISE EXCEPTION 'MES_POST_SYNC_PARENT_INVALID'; END IF;
  SELECT array_agg(s.business_name ORDER BY s.business_name) INTO names
  FROM public.preliminary_survey s
  WHERE s.measurement_date = (parent.request_payload->>'scheduled_date_kst')::date
    AND s.year IS NOT NULL AND s.year > 0 AND trim(coalesce(s.period,'')) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.measurement_business m
      WHERE m.year = s.year AND trim(m.period) = trim(s.period) AND (
        (nullif(trim(s.code),'') IS NOT NULL AND trim(m.code) = trim(s.code)) OR
        (nullif(replace(replace(regexp_replace(coalesce(s.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사',''),'') IS NOT NULL
         AND nullif(replace(replace(regexp_replace(coalesce(m.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사',''),'') IS NOT NULL AND (
          replace(replace(regexp_replace(coalesce(m.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사','')
            = replace(replace(regexp_replace(coalesce(s.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사','') OR
          strpos(
            replace(replace(regexp_replace(coalesce(m.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사',''),
            replace(replace(regexp_replace(coalesce(s.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사','')
          ) > 0 OR
          strpos(
            replace(replace(regexp_replace(coalesce(s.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사',''),
            replace(replace(regexp_replace(coalesce(m.business_name,''), '[[:space:]]+', '', 'g'),'(주)',''),'주식회사','')
          ) > 0
        ))
      )
    );
  IF coalesce(array_length(names,1),0) = 0 THEN RETURN; END IF;
  message := format('[MES 미등록 경고] ''%s''%s 업체가 금일 14:00까지 MES에 등록되지 않았습니다. 기사의 당일 등록 확인이 필요합니다.',
    names[1], CASE WHEN array_length(names,1) > 1 THEN format(' 외 %s개', array_length(names,1)-1) ELSE '' END);
  INSERT INTO public.notifications(user_id,type,message,is_read)
  SELECT id, 'mes_sync_warning', message, false FROM public.users WHERE is_journal_manager = true;
END;
$$;
CREATE OR REPLACE FUNCTION public.enqueue_mes_final_post_sync_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'COMPLETED' AND NEW.status = 'COMPLETED'
    AND NEW.job_type = 'MES_SYNC'
    AND NEW.request_payload @> '{"trigger":"scheduled","slot":"14:00","final_check":true}'::jsonb
    AND NEW.result_payload @> '{"syncSuccess":true}'::jsonb THEN
    INSERT INTO public.automation_jobs(job_type,idempotency_key,target_key,request_payload)
    VALUES ('MES_POST_SYNC_CHECK', 'mes-post-sync:' || NEW.id::text,
      'mes-post-sync:' || NEW.id::text, jsonb_build_object('parent_job_id', NEW.id))
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mes_final_post_sync_check ON public.automation_jobs;
CREATE TRIGGER trg_mes_final_post_sync_check
AFTER UPDATE OF status ON public.automation_jobs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_mes_final_post_sync_check();
REVOKE ALL ON FUNCTION public.run_mes_final_post_sync_check(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_mes_final_post_sync_check() FROM PUBLIC;

-- Server-only drain.  Each notification attempt uses an exception
-- subtransaction: partial inserts roll back, and the MES parent stays terminal.
CREATE OR REPLACE FUNCTION public.process_mes_post_sync_checks(p_limit INTEGER DEFAULT 10)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE action public.automation_jobs;
DECLARE attempts INTEGER;
DECLARE processed INTEGER := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'MES_POST_SYNC_LIMIT_INVALID'; END IF;
  FOR action IN SELECT * FROM public.automation_jobs
    WHERE job_type = 'MES_POST_SYNC_CHECK' AND status = 'PENDING'
      AND available_at <= CURRENT_TIMESTAMP
    ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    attempts := coalesce((action.result_payload->>'attempts')::INTEGER, 0) + 1;
    BEGIN
      PERFORM public.run_mes_final_post_sync_check((action.request_payload->>'parent_job_id')::UUID);
      UPDATE public.automation_jobs SET status='COMPLETED', progress_stage='최종 점검 완료',
        progress_percent=100, result_code='MES_POST_SYNC_CHECKED',
        result_payload=jsonb_build_object('attempts',attempts), finished_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE id=action.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.automation_jobs SET status=CASE WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
        available_at=CURRENT_TIMESTAMP + (attempts * INTERVAL '5 minutes'),
        progress_stage='최종 점검 재시도 대기', error_code=SQLSTATE,
        error_message=left(SQLERRM,1000), result_payload=jsonb_build_object('attempts',attempts),
        finished_at=CASE WHEN attempts >= 3 THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP WHERE id=action.id;
    END;
    processed := processed + 1;
  END LOOP;
  RETURN processed;
END $$;
REVOKE ALL ON FUNCTION public.process_mes_post_sync_checks(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_mes_post_sync_checks(INTEGER) TO service_role;

-- A legacy claimer racing the initial preflight must not survive commit.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.background_jobs
    WHERE job_type='national_support' AND status IN ('pending','processing','cancel_requested'))
    OR EXISTS (SELECT 1 FROM public.document_generation_jobs
      WHERE status IN ('PENDING','PROCESSING')) THEN
    RAISE EXCEPTION 'AUTOMATION_CUTOVER_LEGACY_ACTIVE_QUARANTINE';
  END IF;
END $$;
