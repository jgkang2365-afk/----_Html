-- K2B 원본 receipt는 기존 measurement_journal 입력값과 분리한다.
-- 이 migration은 forward-only이며 k2b_status/k2b_send_date/k2b_sender를 변경하지 않는다.
CREATE TABLE IF NOT EXISTS public.k2b_file_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  actual_submission_date DATE NOT NULL,
  business_year TEXT NOT NULL,
  half TEXT NOT NULL,
  support_type TEXT NOT NULL,
  submission_number TEXT,
  management_number TEXT NOT NULL,
  commencement_number TEXT NOT NULL,
  sequence_number TEXT NOT NULL,
  business_name TEXT NOT NULL,
  k2b_status TEXT NOT NULL DEFAULT '',
  fallback_key_used BOOLEAN NOT NULL DEFAULT FALSE,
  raw_receipt JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_job_id UUID REFERENCES public.background_jobs(id),
  CONSTRAINT k2b_file_receipts_source_key_unique UNIQUE (source_key)
);
CREATE INDEX IF NOT EXISTS idx_k2b_file_receipts_actual_submission_date ON public.k2b_file_receipts(actual_submission_date);

CREATE TABLE IF NOT EXISTS public.k2b_sync_state (
  state_key TEXT PRIMARY KEY DEFAULT 'default' CHECK (state_key = 'default'),
  last_successful_through_date DATE,
  last_successful_sync_at TIMESTAMPTZ,
  last_successful_job_id UUID REFERENCES public.background_jobs(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public.k2b_sync_state(state_key) VALUES ('default') ON CONFLICT (state_key) DO NOTHING;

ALTER TABLE public.k2b_file_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.k2b_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.k2b_file_receipts, public.k2b_sync_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_k2b_file_receipt(p_receipt JSONB, p_job_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE receipt_id UUID;
DECLARE current_receipt JSONB;
DECLARE disposition TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'K2B_SERVICE_ROLE_ONLY';
  END IF;
  IF jsonb_typeof(p_receipt) <> 'object'
    OR COALESCE(p_receipt->>'sourceKey', '') = ''
    OR COALESCE(p_receipt->>'actualSubmissionDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
    OR COALESCE(p_receipt->>'fileName', '') = ''
    OR COALESCE(p_receipt->>'companyName', '') = ''
    OR COALESCE(p_receipt->>'businessYear', '') = ''
    OR COALESCE(p_receipt->>'half', '') = ''
    OR COALESCE(p_receipt->>'supportType', '') = ''
    OR COALESCE(p_receipt->>'managementNumber', '') = ''
    OR COALESCE(p_receipt->>'commencementNumber', '') = ''
    OR COALESCE(p_receipt->>'sequenceNumber', '') = ''
    OR COALESCE(p_receipt->>'status', '') = ''
    OR (COALESCE(p_receipt->>'submissionNumber', '') = '' AND COALESCE(p_receipt->>'identityFallback', 'false') <> 'true') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_K2B_RECEIPT';
  END IF;
  SELECT raw_receipt INTO current_receipt FROM public.k2b_file_receipts WHERE source_key = p_receipt->>'sourceKey' FOR UPDATE;
  IF NOT FOUND THEN
    disposition := 'inserted';
  ELSIF current_receipt = p_receipt THEN
    disposition := 'unchanged';
  ELSE
    disposition := 'updated';
  END IF;
  INSERT INTO public.k2b_file_receipts (
    source_key, file_name, actual_submission_date, business_year, half, support_type, submission_number, management_number,
    commencement_number, sequence_number, business_name, k2b_status, fallback_key_used, raw_receipt, last_sync_job_id
  ) VALUES (
    p_receipt->>'sourceKey', p_receipt->>'fileName', (p_receipt->>'actualSubmissionDate')::DATE, p_receipt->>'businessYear',
    p_receipt->>'half', p_receipt->>'supportType', NULLIF(p_receipt->>'submissionNumber', ''), p_receipt->>'managementNumber',
    p_receipt->>'commencementNumber', p_receipt->>'sequenceNumber', p_receipt->>'companyName', p_receipt->>'status',
    COALESCE((p_receipt->>'identityFallback')::BOOLEAN, FALSE), p_receipt, p_job_id
  ) ON CONFLICT (source_key) DO UPDATE SET
    file_name = EXCLUDED.file_name, actual_submission_date = EXCLUDED.actual_submission_date, business_year = EXCLUDED.business_year,
    half = EXCLUDED.half, support_type = EXCLUDED.support_type, submission_number = EXCLUDED.submission_number,
    management_number = EXCLUDED.management_number, commencement_number = EXCLUDED.commencement_number, sequence_number = EXCLUDED.sequence_number,
    business_name = EXCLUDED.business_name, k2b_status = EXCLUDED.k2b_status, fallback_key_used = EXCLUDED.fallback_key_used,
    raw_receipt = EXCLUDED.raw_receipt, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, last_sync_job_id = EXCLUDED.last_sync_job_id
  RETURNING id INTO receipt_id;
  RETURN jsonb_build_object('id', receipt_id, 'disposition', disposition);
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_k2b_sync_cursor(p_through_date DATE, p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'K2B_SERVICE_ROLE_ONLY';
  END IF;
  INSERT INTO public.k2b_sync_state(state_key, last_successful_through_date, last_successful_sync_at, last_successful_job_id, updated_at)
  VALUES ('default', p_through_date, CURRENT_TIMESTAMP, p_job_id, CURRENT_TIMESTAMP)
  ON CONFLICT (state_key) DO UPDATE SET
    last_successful_through_date = GREATEST(public.k2b_sync_state.last_successful_through_date, EXCLUDED.last_successful_through_date),
    last_successful_sync_at = CURRENT_TIMESTAMP, last_successful_job_id = EXCLUDED.last_successful_job_id, updated_at = CURRENT_TIMESTAMP;
END;
$$;

-- 기존 직렬화 queue 계약을 보존하며 원본 동기화 job만 추가한다.
CREATE OR REPLACE FUNCTION public.enqueue_k2b_automation_job(p_job_type TEXT, p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE created_job_id UUID;
BEGIN
  IF p_job_type NOT IN ('k2b', 'k2b_verify', 'k2b_original_sync') OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_K2B_AUTOMATION_JOB';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('k2b-automation-serialization'));
  UPDATE public.background_jobs SET status = 'failed', error_message = 'legacy K2B guard heartbeat가 30분 이상 없어 자동 만료됨',
    finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE job_type = 'k2b_legacy_direct' AND status = 'processing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes';
  IF EXISTS (SELECT 1 FROM public.background_jobs
    WHERE job_type IN ('k2b', 'k2b_verify', 'k2b_original_sync', 'k2b_legacy_direct')
      AND status IN ('pending', 'processing', 'cancel_requested')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'K2B_AUTOMATION_ALREADY_ACTIVE';
  END IF;
  INSERT INTO public.background_jobs(job_type, status, payload, available_at, attempt_count)
  VALUES (p_job_type, 'pending', p_payload, CURRENT_TIMESTAMP, 0) RETURNING id INTO created_job_id;
  RETURN created_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_k2b_original_sync_job(p_payload JSONB)
RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT public.enqueue_k2b_automation_job('k2b_original_sync', p_payload); $$;

-- legacy /upload-k2b 동기 응답은 유지하되 원본 동기화가 처리 중일 때도 동일한 직렬화 경계를 적용한다.
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
  UPDATE public.background_jobs SET status = 'failed', error_message = 'legacy K2B guard heartbeat가 30분 이상 없어 자동 만료됨',
    finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE job_type = 'k2b_legacy_direct' AND status = 'processing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes';
  IF EXISTS (SELECT 1 FROM public.background_jobs
    WHERE job_type IN ('k2b', 'k2b_verify', 'k2b_original_sync', 'k2b_legacy_direct')
      AND status IN ('pending', 'processing', 'cancel_requested')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'K2B_AUTOMATION_ALREADY_ACTIVE';
  END IF;
  INSERT INTO public.background_jobs (job_type, status, payload, available_at, attempt_count, started_at, execution_result)
  VALUES ('k2b_legacy_direct', 'processing', p_payload, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP,
    jsonb_build_object('uploadExecuted', false, 'trigger', 'legacy_direct'))
  RETURNING id INTO created_job_id;
  RETURN created_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_k2b_file_receipt(JSONB, UUID), public.advance_k2b_sync_cursor(DATE, UUID), public.enqueue_k2b_original_sync_job(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_k2b_file_receipt(JSONB, UUID), public.advance_k2b_sync_cursor(DATE, UUID), public.enqueue_k2b_original_sync_job(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.claim_k2b_legacy_direct_job(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_k2b_legacy_direct_job(JSONB) TO service_role;
COMMENT ON TABLE public.k2b_file_receipts IS 'K2B 화면에서 header 기반으로 읽은 원본 접수 receipt; source_key upsert로 재조회 idempotent';
COMMENT ON TABLE public.k2b_sync_state IS 'scheduled K2B 원본 동기화의 마지막 전체 성공 cursor';
NOTIFY pgrst, 'reload schema';
