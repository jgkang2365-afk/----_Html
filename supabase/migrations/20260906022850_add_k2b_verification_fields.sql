-- 기존 K2B 입력값(k2b_status/k2b_send_date/k2b_sender)은 보존한다.
-- 실제 접수결과 관측값과 내부 입력값의 정합성은 별도 필드에 기록한다.
ALTER TABLE public.measurement_journal
  ADD COLUMN IF NOT EXISTS k2b_verified_status TEXT,
  ADD COLUMN IF NOT EXISTS k2b_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS k2b_verified_send_date DATE,
  ADD COLUMN IF NOT EXISTS k2b_verified_result_date DATE,
  ADD COLUMN IF NOT EXISTS k2b_verified_remote_status TEXT,
  ADD COLUMN IF NOT EXISTS k2b_consistency_status TEXT,
  ADD COLUMN IF NOT EXISTS k2b_consistency_note TEXT,
  ADD COLUMN IF NOT EXISTS k2b_verification_error TEXT,
  ADD COLUMN IF NOT EXISTS k2b_verification_attempted_at TIMESTAMPTZ;

ALTER TABLE public.measurement_journal
  DROP CONSTRAINT IF EXISTS measurement_journal_k2b_verified_status_check;
ALTER TABLE public.measurement_journal
  ADD CONSTRAINT measurement_journal_k2b_verified_status_check
  CHECK (k2b_verified_status IS NULL OR k2b_verified_status IN ('GREEN', 'YELLOW', 'RED', 'UNVERIFIED', 'STALE'));

ALTER TABLE public.measurement_journal
  DROP CONSTRAINT IF EXISTS measurement_journal_k2b_consistency_status_check;
ALTER TABLE public.measurement_journal
  ADD CONSTRAINT measurement_journal_k2b_consistency_status_check
  CHECK (k2b_consistency_status IS NULL OR k2b_consistency_status IN ('GREEN', 'YELLOW', 'RED', 'UNVERIFIED', 'STALE'));

CREATE INDEX IF NOT EXISTS idx_measurement_journal_k2b_verify_result_date
  ON public.measurement_journal (k2b_verified_result_date, k2b_verified_status)
  WHERE k2b_verified_result_date IS NOT NULL;

-- 같은 KST 결과일의 활성 재검증은 하나만 허용한다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_active_k2b_verify_date
  ON public.background_jobs ((payload->>'resultDate'))
  WHERE job_type = 'k2b_verify' AND status IN ('pending', 'processing', 'cancel_requested');

-- 업로드와 읽기 전용 검증은 공통 queue 등록 함수로만 진입한다.
-- advisory transaction lock과 활성 작업 확인을 한 트랜잭션으로 묶어 브라우저 자동화가 겹치지 않는다.
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
  IF EXISTS (
    SELECT 1 FROM public.background_jobs
    WHERE job_type IN ('k2b', 'k2b_verify')
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
REVOKE ALL ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_automation_job(TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_k2b_verify_job(
  p_result_date DATE,
  p_requested_by BIGINT DEFAULT NULL
) RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.enqueue_k2b_automation_job(
    'k2b_verify',
    jsonb_build_object('resultDate', p_result_date, 'requestedBy', p_requested_by)
  );
$$;
REVOKE ALL ON FUNCTION public.enqueue_k2b_verify_job(DATE, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_verify_job(DATE, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_k2b_upload_job(
  p_payload JSONB
) RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.enqueue_k2b_automation_job('k2b', p_payload);
$$;
REVOKE ALL ON FUNCTION public.enqueue_k2b_upload_job(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_k2b_upload_job(JSONB) TO service_role;

COMMENT ON COLUMN public.measurement_journal.k2b_verified_status IS 'K2B 일일 실제결과 검증 상태; 업로드 상태와 독립';
COMMENT ON COLUMN public.measurement_journal.k2b_verified_send_date IS '실제 K2B 결과에서 확인된 전송일(관측값)';
COMMENT ON COLUMN public.measurement_journal.k2b_consistency_status IS '내부 K2B 전송기록과 실제결과의 정합성 신호';
COMMENT ON FUNCTION public.enqueue_k2b_verify_job(DATE, BIGINT) IS 'K2B 업로드와 직렬화된 날짜별 읽기 전용 검증 작업 등록';
COMMENT ON FUNCTION public.enqueue_k2b_upload_job(JSONB) IS '기존 K2B 업로드 payload를 보존한 채 재검증과 공통 잠금으로 직렬 등록';
NOTIFY pgrst, 'reload schema';
