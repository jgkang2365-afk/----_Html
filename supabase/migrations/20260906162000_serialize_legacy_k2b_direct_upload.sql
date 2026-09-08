-- legacy 동기 endpoint의 응답 계약은 유지하되 queue/verify와 동시에 브라우저를 열지 못하게 한다.
CREATE OR REPLACE FUNCTION public.enqueue_k2b_automation_job(
  p_job_type TEXT,
  p_payload JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE created_job_id UUID;
BEGIN
  IF p_job_type NOT IN ('k2b', 'k2b_verify') OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_K2B_AUTOMATION_JOB';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('k2b-automation-serialization'));
  UPDATE public.background_jobs
  SET status = 'failed',
      error_message = 'legacy K2B guard heartbeat가 30분 이상 없어 자동 만료됨',
      finished_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE job_type = 'k2b_legacy_direct'
    AND status = 'processing'
    AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes';
  IF EXISTS (
    SELECT 1 FROM public.background_jobs
    WHERE job_type IN ('k2b', 'k2b_verify', 'k2b_legacy_direct')
      AND status IN ('pending', 'processing', 'cancel_requested')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'K2B_AUTOMATION_ALREADY_ACTIVE';
  END IF;
  INSERT INTO public.background_jobs (job_type, status, payload, available_at, attempt_count)
  VALUES (p_job_type, 'pending', p_payload, CURRENT_TIMESTAMP, 0)
  RETURNING id INTO created_job_id;
  RETURN created_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_k2b_legacy_direct_job(
  p_payload JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE created_job_id UUID;
BEGIN
  IF jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_K2B_AUTOMATION_JOB';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('k2b-automation-serialization'));
  UPDATE public.background_jobs
  SET status = 'failed',
      error_message = 'legacy K2B guard heartbeat가 30분 이상 없어 자동 만료됨',
      finished_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE job_type = 'k2b_legacy_direct'
    AND status = 'processing'
    AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes';
  IF EXISTS (
    SELECT 1 FROM public.background_jobs
    WHERE job_type IN ('k2b', 'k2b_verify', 'k2b_legacy_direct')
      AND status IN ('pending', 'processing', 'cancel_requested')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'K2B_AUTOMATION_ALREADY_ACTIVE';
  END IF;
  INSERT INTO public.background_jobs (
    job_type, status, payload, available_at, attempt_count, started_at, execution_result
  ) VALUES (
    'k2b_legacy_direct', 'processing', p_payload, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP,
    jsonb_build_object('uploadExecuted', false, 'trigger', 'legacy_direct')
  ) RETURNING id INTO created_job_id;
  RETURN created_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_k2b_legacy_direct_job(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_k2b_legacy_direct_job(JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
